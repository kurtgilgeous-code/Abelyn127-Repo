import { pbkdf2, randomBytes, randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { promisify } from 'node:util'

const derive = promisify(pbkdf2)
const iterations = 100_000 // the most Cloudflare Workers can verify

function askHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('Run this command in an interactive terminal so the password can be entered without echo.')
  }
  process.stdout.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const handleData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) {
          process.stdin.off('data', handleData)
          process.stdin.setRawMode(false)
          process.stdout.write('\n')
          reject(new Error('Admin setup cancelled.'))
          return
        }
        if (byte === 13 || byte === 10) {
          process.stdin.off('data', handleData)
          process.stdin.setRawMode(false)
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (byte === 8 || byte === 127) {
          value = value.slice(0, -1)
          continue
        }
        if (byte >= 32) value += String.fromCharCode(byte)
      }
    }
    process.stdin.on('data', handleData)
  })
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

async function main() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const username = (await prompt.question('Admin username (3-32 lowercase letters, numbers, dots, underscores, or hyphens): '))
    .trim().toLowerCase()
  const fullName = (await prompt.question('Admin display name: ')).trim()
  prompt.close()

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Enter a valid admin username.')
  if (!fullName || fullName.length > 100) throw new Error('Enter an admin display name between 1 and 100 characters.')
  const password = await askHidden('Admin password (12+ characters, input hidden): ')
  const confirmation = await askHidden('Confirm password (input hidden): ')
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password must be at least 12 characters and no more than 72 UTF-8 bytes.')
  }
  if (password !== confirmation) throw new Error('Passwords do not match.')

  const salt = randomBytes(16)
  const hash = await derive(password, salt, iterations, 'sha256')
  const passwordHash = `pbkdf2$${iterations}$${salt.toString('base64url')}$${hash.toString('base64url')}`
  const id = randomUUID()
  const statement = `INSERT INTO users (id, full_name, email, username, password_hash, role) VALUES (${sqlString(id)}, ${sqlString(fullName)}, NULL, ${sqlString(username)}, ${sqlString(passwordHash)}, 'ADMIN') ON CONFLICT(username) DO UPDATE SET full_name = excluded.full_name, email = NULL, password_hash = excluded.password_hash, role = 'ADMIN';`
  console.log('\nRun this SQL against the Cloudflare D1 database using the Cloudflare dashboard or Wrangler:\n')
  console.log(statement)
  console.log('\nKeep the SQL private: it contains the admin password hash.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Could not prepare the admin SQL.')
  process.exitCode = 1
})
