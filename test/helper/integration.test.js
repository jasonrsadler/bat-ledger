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
const helperDomain = process.env.BAT_HELPER_SERVER || 'https://eyeshade-staging.mercury.basicattentiontoken.org'
test('eyeshade: get json url from eyeshade server', async t => {
  t.plan(20)
  const url = '/v1/rates'
  const expect = true
  const { body } = await req({ url, expect })
  const { altrates } = body
  const { ETH, BTC, USD, LTC } = altrates
  checkKeys(ETH)
  checkKeys(BTC)
  checkKeys(USD)
  checkKeys(LTC)

  function checkKeys (shallow) {
    Object.keys(shallow).forEach(key => {
      coerceAndCheck(shallow[key])
    })
  }

  function coerceAndCheck (possibleString) {
    const number = +possibleString
    t.true(!isNaN(number) && typeof number === 'number')
  }
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
