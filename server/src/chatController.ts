import { GoogleGenAI } from '@google/genai'
import type { Request, Response } from 'express'
import {
  GERAINT_ATTEMPT_TIMEOUT_MS,
  GERAINT_GENERATION_CONFIG,
  GERAINT_SYSTEM_INSTRUCTION,
  GERAINT_UNAVAILABLE_MESSAGE,
  geraintModelChain,
  parseChatMessages,
  toGeminiContents,
} from './geraint.js'

let client: GoogleGenAI | undefined
let clientKey = ''

function geminiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) return null
  if (!client || clientKey !== apiKey) {
    client = new GoogleGenAI({ apiKey })
    clientKey = apiKey
  }
  return client
}

export async function geraintChat(request: Request, response: Response) {
  const ai = geminiClient()
  if (!ai) {
    console.error('Geraint chat is unavailable: GEMINI_API_KEY is not set. Add it to .env and restart the server.')
    response.status(503).json({ message: GERAINT_UNAVAILABLE_MESSAGE })
    return
  }
  const messages = parseChatMessages(request.body)
  if (!messages) {
    response.status(400).json({ message: 'Geraint could not read that message. Please send a shorter message and try again.' })
    return
  }

  const contents = toGeminiContents(messages)
  for (const model of geraintModelChain(process.env.GEMINI_MODEL)) {
    try {
      const result = await ai.models.generateContent({
        model,
        contents,
        config: {
          ...GERAINT_GENERATION_CONFIG,
          systemInstruction: GERAINT_SYSTEM_INSTRUCTION,
          abortSignal: AbortSignal.timeout(GERAINT_ATTEMPT_TIMEOUT_MS),
        },
      })
      const reply = result.text?.trim()
      if (reply) {
        response.json({ reply })
        return
      }
      console.error(`Gemini model ${model} returned an empty reply.`)
    } catch (error) {
      console.error(`Gemini model ${model} failed:`, error instanceof Error ? error.message : error)
    }
  }
  response.status(502).json({ message: GERAINT_UNAVAILABLE_MESSAGE })
}
