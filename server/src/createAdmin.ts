import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { closeDatabase, createOrUpdateAdmin, ensureUserSchema } from './db.js'

const rootEnvPath = fileURLToPath(new URL('../../.env', import.meta.url))
const rootEnvExamplePath = fileURLToPath(new URL('../../.env.example', import.meta.url))
dotenv.config({ path: rootEnvPath })

function askHidden(prompt: string) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('Run this command in an interactive terminal so the password can be entered without echo.')
  }

  process.stdout.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  return new Promise<string>((resolve, reject) => {
    let value = ''
    const handleData = (chunk: Buffer) => {
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

function setEnvValue(contents: string, key: string, value: string) {
  const expression = new RegExp(`^${key}=.*$`, 'm')
  if (expression.test(contents)) return contents.replace(expression, `${key}=${value}`)
  return `${contents.trimEnd()}\n${key}=${value}\n`
}

async function main() {
  if (process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32)) {
    throw new Error('Set JWT_SECRET in the deployment environment before creating the admin account.')
  }
  await ensureUserSchema()
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const defaultUsername = process.env.ADMIN_USERNAME?.trim().toLowerCase() || 'gerzeke26'
  const username = ((await prompt.question(`Admin username [${defaultUsername}]: `)).trim() || defaultUsername).toLowerCase()
  const fullName = (await prompt.question('Admin display name: ')).trim()
  prompt.close()

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error('Use 3–32 lowercase letters, numbers, dots, underscores, or hyphens for the username.')
  }
  if (!fullName || fullName.length > 100) {
    throw new Error('Enter an admin display name between 1 and 100 characters.')
  }

  const password = await askHidden('Admin password (12+ characters, input hidden): ')
  const confirmation = await askHidden('Confirm password (input hidden): ')
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password must be at least 12 characters and no more than 72 UTF-8 bytes.')
  }
  if (password !== confirmation) throw new Error('Passwords do not match.')

  const passwordHash = await bcrypt.hash(password, 12)
  const admin = await createOrUpdateAdmin({ fullName, username, passwordHash })

  if (process.env.NODE_ENV === 'production') {
    console.log('JWT signing secret is provided by the deployment environment.')
  } else {
    let contents: string
    try {
      contents = await readFile(rootEnvPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      contents = await readFile(rootEnvExamplePath, 'utf8')
    }
    const jwtSecret = process.env.JWT_SECRET || randomBytes(48).toString('base64url')
    contents = setEnvValue(contents, 'JWT_SECRET', jwtSecret)
    await writeFile(rootEnvPath, contents, { encoding: 'utf8', mode: 0o600 })
  }

  console.log(`Admin account "${admin.username}" is saved in PostgreSQL.`)
  if (process.env.NODE_ENV !== 'production') {
    console.log(`A JWT signing secret is configured in ${path.basename(rootEnvPath)}.`)
    console.log('Restart the development server before signing in.')
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Could not create the admin account.')
  process.exitCode = 1
}).finally(() => closeDatabase())
