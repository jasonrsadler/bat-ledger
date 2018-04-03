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
  /*
{ altrates:
   { ETH: { BTC: '0.05472100', USD: '405.50000000' },
     BTC:
      { ETH: 18.274519836991285,
        USD: '7406.79000000',
        LTC: 57.32958780026372 },
     USD: { ETH: 0.002466091245376079, BTC: 0.00013501125318795323 },
     LTC: { BTC: '0.01744300' } },
  fxrates: { rates: {} },
  rates: {} }
  */
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
