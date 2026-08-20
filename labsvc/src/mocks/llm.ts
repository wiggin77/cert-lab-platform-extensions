/**
 * Mock LLM, OpenAI compatible, for Module 6's AI skills.
 *
 * Configure the Agents plugin with service type "OpenAI Compatible" and API URL
 * http://workbench:4000/mock/llm/v1
 *
 * Setup gotcha: the Agents plugin rejects a blank API key even for local services, so the
 * track setup script must set a dummy non-empty value.
 *
 * Deterministic on purpose. No key in a public sandbox, no per learner token cost, no
 * egress, works offline, and the grader gets text it can actually assert against.
 */

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, resolve} from 'node:path'
import type {FastifyInstance} from 'fastify'

import type {Journal} from '../proxy/journal.js'
import type {Severity} from '../types.js'
import {jsonBody} from '../util/body.js'

const HERE = dirname(fileURLToPath(import.meta.url))

type LlmFixture = {default: string; responses: Record<string, string>}

const fixture = JSON.parse(readFileSync(resolve(HERE, '../../fixtures/llm-responses.json'), 'utf8')) as LlmFixture

const MODEL_ID = 'lab-threat-analyst-v1'

type ChatMessage = {role: string; content: string | Array<{type: string; text?: string}>}

type ChatRequest = {
    model?: string
    messages?: ChatMessage[]
    stream?: boolean
    temperature?: number
}

type Skill = 'analyze_threat_surface' | 'suggest_remediation'

function flatten(messages: ChatMessage[]): string {
    return messages
        .map((m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((c) => c.text ?? '').join(' ')))
        .join('\n')
}

/** Classifies intent from the prompt text. Keep the cues broad, learners word prompts freely. */
export function classify(prompt: string): {skill: Skill; severity: Severity} {
    const p = prompt.toLowerCase()

    const remediationCues = ['remediat', 'mitigat', 'fix', 'respond', 'containment', 'next step', 'what should']
    const skill: Skill = remediationCues.some((c) => p.includes(c)) ? 'suggest_remediation' : 'analyze_threat_surface'

    const severity: Severity = p.includes('critical') ? 'CRITICAL' : p.includes('high') ? 'HIGH' : 'INFO'

    return {skill, severity}
}

function completionFor(prompt: string): {text: string; skill: Skill; severity: Severity} {
    const {skill, severity} = classify(prompt)
    return {text: fixture.responses[`${skill}:${severity}`] ?? fixture.default, skill, severity}
}

/** Rough token estimate. The Agents plugin only ever displays this. */
function tokens(s: string): number {
    return Math.max(1, Math.ceil(s.length / 4))
}

export function registerMockLlm(app: FastifyInstance, deps: {journal: Journal}): void {
    app.get('/mock/llm/v1/models', async () => ({
        object: 'list',
        data: [{id: MODEL_ID, object: 'model', created: 1755000000, owned_by: 'mattermost-cert-lab'}],
    }))

    app.post('/mock/llm/v1/chat/completions', async (req, reply) => {
        const body = jsonBody<ChatRequest>(req, {})
        const prompt = flatten(body.messages ?? [])
        const {text, skill, severity} = completionFor(prompt)
        const id = `chatcmpl-lab-${Date.now().toString(36)}`
        const created = Math.floor(Date.now() / 1000)

        deps.journal.append({
            kind: 'llm_call',
            route: '/mock/llm/v1/chat/completions',
            correlationId: (req.headers['x-lab-correlation-id'] as string) ?? 'agents-plugin',
            request: {headers: {}, body: {model: body.model, stream: !!body.stream, prompt}, method: 'POST'},
            response: {headers: {}, body: {skill, severity, chars: text.length}, status: 200},
            notes: [`Classified as ${skill} at ${severity} severity`],
        })

        if (!body.stream) {
            return reply.send({
                id,
                object: 'chat.completion',
                created,
                model: body.model ?? MODEL_ID,
                choices: [{index: 0, message: {role: 'assistant', content: text}, finish_reason: 'stop'}],
                usage: {
                    prompt_tokens: tokens(prompt),
                    completion_tokens: tokens(text),
                    total_tokens: tokens(prompt) + tokens(text),
                },
            })
        }

        reply.raw.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
        })

        const frame = (delta: Record<string, unknown>, finish: string | null) =>
            `data: ${JSON.stringify({
                id,
                object: 'chat.completion.chunk',
                created,
                model: body.model ?? MODEL_ID,
                choices: [{index: 0, delta, finish_reason: finish}],
            })}\n\n`

        reply.raw.write(frame({role: 'assistant', content: ''}, null))

        // Chunked by word so the Agents plugin renders a live typing effect, which is
        // what makes the Module 6 loading state visibly do something.
        const words = text.split(/(\s+)/)
        for (let i = 0; i < words.length; i += 4) {
            reply.raw.write(frame({content: words.slice(i, i + 4).join('')}, null))
            await new Promise((r) => setTimeout(r, 12))
        }

        reply.raw.write(frame({}, 'stop'))
        reply.raw.write('data: [DONE]\n\n')
        reply.raw.end()
        return reply
    })
}
