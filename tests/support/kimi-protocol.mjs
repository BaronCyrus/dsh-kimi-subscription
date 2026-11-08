// The Kimi Code protocol of the installed pi-ai, for tests that read requests.
//
// pi-ai 1.1.0 (DSH 0.2.1) speaks Anthropic Messages under /coding; pi-ai 1.3.0
// (DSH 0.2.2) speaks OpenAI Chat Completions under /coding/v1. The plugin uses
// whichever the host ships, so a test reads requests through these helpers and
// runs unchanged against either host.
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'

const catalog = kimiCodingProvider()
const apis = new Set(catalog.getModels().map(model => model.api))
if (apis.size !== 1) throw new Error(`pi-ai's Kimi Code catalog mixes protocols: ${[...apis].join(', ')}`)

/** The protocol every Kimi Code model of the installed pi-ai uses. */
export const KIMI_API = [...apis][0]

/** The base URL of the installed pi-ai Kimi Code provider. */
export const KIMI_CATALOG_BASE_URL = catalog.baseUrl

const PROTOCOLS = Object.freeze({
  'anthropic-messages': Object.freeze({
    basePath: '/coding',
    requestPath: '/v1/messages',
    systemPrompts: body => body.system?.map(block => block.text),
    tools: body => body.tools?.map(tool => [tool.name, tool.description, tool.input_schema]),
    thinking: body => ({ thinking: body.thinking, output_config: body.output_config }),
    effort: body => (body.thinking?.type === 'adaptive' ? body.output_config?.effort : undefined),
    apiKey: headers => headers.get('x-api-key') ?? undefined,
  }),
  'openai-completions': Object.freeze({
    basePath: '/coding/v1',
    requestPath: '/chat/completions',
    systemPrompts: body => body.messages?.filter(message => message.role === 'system')
      .map(message => (typeof message.content === 'string' ? message.content : message.content.map(part => part.text).join(''))),
    tools: body => body.tools?.map(tool => [tool.function.name, tool.function.description, tool.function.parameters]),
    thinking: body => ({ thinking: body.thinking, reasoning_effort: body.reasoning_effort }),
    effort: body => body.reasoning_effort,
    apiKey: headers => headers.get('authorization')?.replace(/^Bearer /u, ''),
  }),
})

const protocol = PROTOCOLS[KIMI_API]
if (protocol === undefined) throw new Error(`no test reader for the Kimi Code protocol ${KIMI_API}`)
if (KIMI_CATALOG_BASE_URL !== `https://api.kimi.com${protocol.basePath}`) {
  throw new Error(`pi-ai's Kimi Code base URL ${KIMI_CATALOG_BASE_URL} does not match ${KIMI_API}`)
}

/** The model base URL on one API origin, as the plugin derives it. */
export const kimiBaseUrl = (origin = 'https://api.kimi.com') => `${origin}${protocol.basePath}`

/** Where a model request to one API origin goes. */
export const kimiModelUrl = (origin = 'https://api.kimi.com') => `${kimiBaseUrl(origin)}${protocol.requestPath}`

/** The system prompt texts a request body carries. */
export const systemPromptsOf = body => protocol.systemPrompts(body)

/** Each tool a request body offers, as [name, description, JSON schema]. */
export const toolsOf = body => protocol.tools(body)

/** Every thinking field of a request body; all undefined when none was sent. */
export const thinkingFieldsOf = body => protocol.thinking(body)

/** The thinking effort a request body asks for, if any. */
export const effortOf = body => protocol.effort(body)

/** The API key a model request carries, read from its fetch init. */
export const apiKeyOf = init => protocol.apiKey(new Headers(init?.headers ?? {}))
