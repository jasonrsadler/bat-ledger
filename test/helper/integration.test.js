// get information that a payment occurred
// user voted for various publishers (redis)
// pulling a report for publishers / surveyors
// check math
import request from 'supertest'
import test from 'ava'
import { extras } from '../../bat-utils'
import dotenv from 'dotenv'
dotenv.config()
const { utils } = extras
const { requestOk } = utils
const token = 'foobarfoobar'
const helperDomain = process.env.HELPER_URL || 'https://eyeshade-staging.mercury.basicattentiontoken.org'
console.log(process.env.HELPER_URL)
test('eyeshade: get json url from eyeshade server', async t => {
  t.plan(1)
  const url = '/v1/rates'
  const expect = true
  const { body } = await req({ url, expect })
  console.log(body)
  t.true(body && typeof body === 'object')
})

async function req ({ url, domain, expect }) {
  const host = domain || helperDomain
  const authorization = `Bearer ${token}`
  let response = request(host)
    .get(url)
    .set('Authorization', authorization)
  response = expect ? response.expect(requestOk) : response
  return response
}
