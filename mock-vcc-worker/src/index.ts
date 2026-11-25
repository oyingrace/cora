import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createHmac, randomBytes, randomInt } from 'node:crypto'

interface Env {
	MOCK_VCC_KV: KVNamespace
	INVOICE_XLM: string
	CALLBACK_DELAY_MS: string
	STELLAR_NETWORK: string
}

interface TokenData {
	label: string
	createdAt: string
}

interface JobData {
	id: string
	order_id: string
	amount_usdc: string
	callback_url: string
	callback_secret: string
	callback_nonce: string
	ctx_order_id: string
	payment_url: string
	status: 'invoice_issued' | 'queued' | 'fulfilling' | 'fulfilled' | 'callback_failed'
	error?: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
	origin: '*',
	allowMethods: ['GET', 'POST'],
	allowHeaders: ['Content-Type', 'X-VCC-Token'],
}))

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

// ── KV Helpers ────────────────────────────────────────────────────────────────

async function getTokens(kv: KVNamespace): Promise<Map<string, TokenData>> {
	try {
		console.log('[mock-vcc] getTokens: reading from KV')
		const data = await kv.get('tokens', { type: 'json' }) as [string, TokenData][] | null
		console.log('[mock-vcc] getTokens: raw data', { dataType: Array.isArray(data) ? 'array' : typeof data, length: data?.length })
		if (!data) return new Map()
		const map = new Map<string, TokenData>(data)
		console.log('[mock-vcc] getTokens: map created', { size: map.size })
		return map
	} catch (err) {
		console.error('[mock-vcc] getTokens error:', err)
		return new Map()
	}
}

async function saveTokens(kv: KVNamespace, tokens: Map<string, TokenData>) {
	try {
		console.log('[mock-vcc] saveTokens: saving to KV', { size: tokens.size })
		await kv.put('tokens', JSON.stringify(Array.from(tokens.entries())))
		console.log('[mock-vcc] saveTokens: success')
	} catch (err) {
		console.error('[mock-vcc] saveTokens error:', err)
		throw err
	}
}

async function getJobs(kv: KVNamespace): Promise<Map<string, JobData>> {
	try {
		console.log('[mock-vcc] getJobs: reading from KV')
		const data = await kv.get('jobs', { type: 'json' }) as [string, JobData][] | null
		console.log('[mock-vcc] getJobs: raw data', { dataType: Array.isArray(data) ? 'array' : typeof data, length: data?.length })
		if (!data) return new Map()
		const map = new Map<string, JobData>(data)
		console.log('[mock-vcc] getJobs: map created', { size: map.size })
		return map
	} catch (err) {
		console.error('[mock-vcc] getJobs error:', err)
		return new Map()
	}
}

async function saveJobs(kv: KVNamespace, jobs: Map<string, JobData>) {
	try {
		console.log('[mock-vcc] saveJobs: saving to KV', { size: jobs.size })
		await kv.put('jobs', JSON.stringify(Array.from(jobs.entries())))
		console.log('[mock-vcc] saveJobs: success')
	} catch (err) {
		console.error('[mock-vcc] saveJobs error:', err)
		throw err
	}
}

async function getDestination(kv: KVNamespace): Promise<string> {
	let dest = await kv.get('destination')
	if (dest) return dest
	dest = 'GBCZGXUJOVAPOBCVB4LCMJBSYDVBYDWPLNDOHD3BQ3646JL3K7HIQMNM'
	await kv.put('destination', dest)
	return dest
}

// ── Stellar/Payment Helpers ──────────────────────────────────────────────────

function memoForOrder(orderId: string): string {
	const compact = orderId.replace(/-/g, '').slice(0, 20)
	return `m${compact}`.slice(0, 28)
}

function buildPaymentUrl(destination: string, amountXlm: string, orderId: string): string {
	const params = new URLSearchParams({
		destination,
		amount: amountXlm,
		memo: memoForOrder(orderId),
	})
	return `web+stellar:pay?${params.toString()}`
}

function signCallback(secret: string, timestamp: string, orderId: string, nonce: string, rawBody: string): string {
	const payload = `${timestamp}.${orderId}.${nonce}.${rawBody}`
	return createHmac('sha256', secret).update(payload).digest('hex')
}

function luhnCheckDigit(partial: string): string {
	let sum = 0
	let alt = true
	for (let i = partial.length - 1; i >= 0; i--) {
		let n = Number(partial[i])
		if (alt) {
			n *= 2
			if (n > 9) n -= 9
		}
		sum += n
		alt = !alt
	}
	return String((10 - (sum % 10)) % 10)
}

function generateVisaPan(): string {
	const bins = ['424242', '400005', '400000', '453201', '455673', '402400']
	let body = bins[randomInt(bins.length)]
	while (body.length < 15) body += String(randomInt(10))
	return body + luhnCheckDigit(body)
}

function fakeCard(amountUsdc: string) {
	const now = new Date()
	const expYear = (now.getFullYear() + 2 + randomInt(3)) % 100
	const expMonth = String(1 + randomInt(12)).padStart(2, '0')
	return {
		number: generateVisaPan(),
		cvv: String(100 + randomInt(900)),
		expiry: `${expMonth}/${String(expYear).padStart(2, '0')}`,
		brand: 'Visa',
	}
}

// ── Card Delivery ─────────────────────────────────────────────────────────────

async function deliverCard(env: Env, job: JobData) {
	const payload = {
		order_id: job.order_id,
		status: 'fulfilled',
		card: fakeCard(job.amount_usdc),
	}
	const body = JSON.stringify(payload)
	const timestamp = String(Date.now())
	const signature = signCallback(
		job.callback_secret,
		timestamp,
		job.order_id,
		job.callback_nonce,
		body
	)

	const headers = {
		'Content-Type': 'application/json',
		'X-VCC-Signature': `sha256=${signature}`,
		'X-VCC-Timestamp': timestamp,
		'X-VCC-Order-Id': job.order_id,
		'X-VCC-Nonce': job.callback_nonce,
	}

	console.log(`[mock-vcc] callback -> ${job.callback_url} order=${job.order_id}`)
	try {
		const res = await fetch(job.callback_url, {
			method: 'POST',
			headers,
			body,
			signal: AbortSignal.timeout(15000),
		})
		const text = await res.text().catch(() => '')
		if (!res.ok) {
			job.status = 'callback_failed'
			job.error = `callback HTTP ${res.status}`
		} else {
			job.status = 'delivered'
			console.log(`[mock-vcc] delivered fake card for ${job.order_id}`)
		}
	} catch (err) {
		job.status = 'callback_failed'
		job.error = err instanceof Error ? err.message : String(err)
		console.error(`[mock-vcc] callback error: ${job.error}`)
	}
}

// ── Auth Middleware ──────────────────────────────────────────────────────────

async function requireToken(c: any, next: any) {
	const token = c.req.header('X-VCC-Token')
	if (!token) {
		return jsonResponse({ error: 'unauthorized' }, 401)
	}
	const tokens = await getTokens(c.env.MOCK_VCC_KV)
	if (!tokens.has(token)) {
		tokens.set(token, { label: 'adopted', createdAt: new Date().toISOString() })
		await saveTokens(c.env.MOCK_VCC_KV, tokens)
	}
	c.set('vccToken', token)
	await next()
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', async (c) => {
	const destination = await getDestination(c.env.MOCK_VCC_KV)
	const jobs = await getJobs(c.env.MOCK_VCC_KV)
	return jsonResponse({ ok: true, destination, jobs: jobs.size })
})

app.post('/api/register', async (c) => {
	const { label = 'cora-mock' } = await c.req.json().catch(() => ({}))
	const token = `mock_vcc_${randomBytes(16).toString('hex')}`
	const tokens = await getTokens(c.env.MOCK_VCC_KV)
	tokens.set(token, { label, createdAt: new Date().toISOString() })
	await saveTokens(c.env.MOCK_VCC_KV, tokens)
	console.log(`[mock-vcc] registered tenant label=${label}`)
	return jsonResponse({ token })
})

app.post('/api/jobs/invoice', requireToken, async (c) => {
	try {
		console.log('[mock-vcc] invoice: parsing request body')
		const body = await c.req.json()
		console.log('[mock-vcc] invoice: body parsed', { keys: Object.keys(body) })
		
		const { order_id, amount_usdc, callback_url, callback_secret, callback_nonce } = body

		if (!order_id || !amount_usdc || !callback_url || !callback_secret || !callback_nonce) {
			console.log('[mock-vcc] invoice: missing fields', { 
				order_id: !!order_id, 
				amount_usdc: !!amount_usdc, 
				callback_url: !!callback_url, 
				callback_secret: !!callback_secret, 
				callback_nonce: !!callback_nonce 
			})
			return jsonResponse({
				error: 'missing_fields',
				message: 'order_id, amount_usdc, callback_url, callback_secret, callback_nonce required',
			}, 400)
		}

		console.log('[mock-vcc] invoice: getting jobs from KV')
		const jobs = await getJobs(c.env.MOCK_VCC_KV)
		console.log('[mock-vcc] invoice: jobs retrieved', { count: jobs.size })

		for (const [jid, job] of jobs) {
			if (job.order_id === order_id) {
				console.log('[mock-vcc] invoice: duplicate order', { order_id })
				return jsonResponse({
					job_id: jid,
					ctx_order_id: job.ctx_order_id,
					payment_url: job.payment_url,
					note: 'already_exists',
				})
			}
		}

		console.log('[mock-vcc] invoice: getting destination')
		const destination = await getDestination(c.env.MOCK_VCC_KV)
		console.log('[mock-vcc] invoice: destination', { destination: destination.slice(0, 8) + '...' })
		
		const invoiceXlm = c.env.INVOICE_XLM || '0.5'

		const jobId = `mock_${randomBytes(8).toString('hex')}`
		const paymentUrl = buildPaymentUrl(destination, invoiceXlm, order_id)
		const ctxOrderId = `mock_ctx_${randomBytes(4).toString('hex')}`

		const job: JobData = {
			id: jobId,
			order_id,
			amount_usdc: String(amount_usdc),
			callback_url,
			callback_secret,
			callback_nonce,
			ctx_order_id: ctxOrderId,
			payment_url: paymentUrl,
			status: 'invoice_issued',
		}

		console.log('[mock-vcc] invoice: saving job', { jobId })
		jobs.set(jobId, job)
		await saveJobs(c.env.MOCK_VCC_KV, jobs)
		console.log('[mock-vcc] invoice: job saved successfully')

		console.log(`[mock-vcc] invoice order=${order_id} amount_usdc=${amount_usdc} xlm=${invoiceXlm} -> ${destination.slice(0, 8)}...`)

		return jsonResponse({
			job_id: jobId,
			ctx_order_id: ctxOrderId,
			payment_url: paymentUrl,
		}, 201)
	} catch (err) {
		console.error('[mock-vcc] invoice error:', err)
		return jsonResponse({ error: 'internal_error', detail: String(err) }, 500)
	}
})

app.post('/api/jobs/:jobId/paid', requireToken, async (c) => {
	const jobId = c.req.param('jobId')
	const jobs = await getJobs(c.env.MOCK_VCC_KV)
	const job = jobs.get(jobId)

	if (!job) return jsonResponse({ error: 'not_found' }, 404)

	if (job.status === 'invoice_issued' || job.status === 'queued') {
		job.status = 'queued'
		await saveJobs(c.env.MOCK_VCC_KV, jobs)

		const delayMs = parseInt(c.env.CALLBACK_DELAY_MS || '400', 10)
		setTimeout(async () => {
			const currentJobs = await getJobs(c.env.MOCK_VCC_KV)
			const currentJob = currentJobs.get(jobId)
			if (currentJob && (currentJob.status === 'queued' || currentJob.status === 'invoice_issued')) {
				currentJob.status = 'fulfilling'
				await saveJobs(c.env.MOCK_VCC_KV, currentJobs)
				await deliverCard(c.env, currentJob)
				await saveJobs(c.env.MOCK_VCC_KV, currentJobs)
			}
		}, delayMs)
	}

	console.log(`[mock-vcc] paid job=${job.id} order=${job.order_id}`)
	return jsonResponse({ ok: true })
})

app.get('/api/jobs/:jobId', requireToken, async (c) => {
	const jobId = c.req.param('jobId')
	const jobs = await getJobs(c.env.MOCK_VCC_KV)
	const job = jobs.get(jobId)

	if (!job) return jsonResponse({ error: 'not_found' }, 404)

	return jsonResponse({
		id: job.id,
		status: job.status,
		ctx_order_id: job.ctx_order_id,
		payment_url: job.payment_url,
		error: job.error || null,
	})
})

export default {
	fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
}