'use strict'
import BigNumber from 'bignumber.js'
import UpholdSDK from '@uphold/uphold-sdk-javascript'
import anonize from 'node-anonize2-relic'
import crypto from 'crypto'
import request from 'supertest'
import test from 'ava'
import tweetnacl from 'tweetnacl'
import uuid from 'uuid'
import { sign } from 'http-request-signature'
import { extras } from '../../bat-utils'
import dotenv from 'dotenv'
dotenv.config()
const { utils } = extras
const {
  requestOk: ok,
  timeout,
  uint8tohex
} = utils

// FIXME assert has env vars set and is using uphold
// NOTE this requires a contibution surveyor to have already been created
test.serial('integration : v2 contribution workflow with uphold BAT wallet', async t => {
  const srv = { listener: process.env.BAT_LEDGER_SERVER || 'https://ledger-staging.mercury.basicattentiontoken.org' }
  const personaId = uuid.v4().toLowerCase()
  const viewingId = uuid.v4().toLowerCase()

  let response = await request(srv.listener).get('/v2/registrar/persona').expect(ok)
  t.true(response.body.hasOwnProperty('registrarVK'))
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)

  const keypair = tweetnacl.sign.keyPair()
  console.log('created new ed25519 keypair')
  console.log(JSON.stringify({
    'publicKey': uint8tohex(keypair.publicKey),
    'secretKey': uint8tohex(keypair.secretKey)
  }))

  const body = {
    label: uuid.v4().toLowerCase(),
    currency: 'BAT',
    publicKey: uint8tohex(keypair.publicKey)
  }
  let octets = JSON.stringify(body)
  let headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  let payload = {
    requestType: 'httpSignature',
    request: {
      body: body,
      headers: headers,
      octets: octets
    },
    proof: personaCredential.request()
  }
  response = await request(srv.listener).post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)
  t.true(response.body.hasOwnProperty('wallet'))
  const paymentId = response.body.wallet.paymentId
  t.true(response.body.wallet.hasOwnProperty('paymentId'))
  t.true(response.body.wallet.hasOwnProperty('addresses'))
  t.true(response.body.hasOwnProperty('verification'))

  t.true(response.body.wallet.addresses.hasOwnProperty('BAT'))
  t.true(response.body.wallet.addresses.hasOwnProperty('BTC'))
  t.true(response.body.wallet.addresses.hasOwnProperty('CARD_ID'))
  t.true(response.body.wallet.addresses.hasOwnProperty('ETH'))
  t.true(response.body.wallet.addresses.hasOwnProperty('LTC'))
  const userCardId = response.body.wallet.addresses.CARD_ID

  personaCredential.finalize(response.body.verification)
  response = await request(srv.listener).get('/v2/wallet?publicKey=' + uint8tohex(keypair.publicKey))
    .expect(ok)
  t.true(response.body.paymentId === paymentId)

  response = await request(srv.listener)
    .get('/v2/surveyor/contribution/current/' + personaCredential.parameters.userId)
    .expect(ok)

  t.true(response.body.hasOwnProperty('surveyorId'))
  const surveyorId = response.body.surveyorId

  t.true(response.body.hasOwnProperty('payload'))
  t.true(response.body.payload.hasOwnProperty('adFree'))
  t.true(response.body.payload.adFree.hasOwnProperty('probi'))
  const donateAmt = new BigNumber(response.body.payload.adFree.probi).dividedBy('1e18').toNumber()

  do { // This depends on currency conversion rates being available, retry until then are available
    response = await request(srv.listener)
      .get('/v2/wallet/' + paymentId + '?refresh=true&amount=1&currency=USD')
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  let err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('balance'))
  t.is(response.body.balance, '0.0000')

  const desired = donateAmt.toFixed(4).toString()

  const upholdBaseUrls = {
    'prod': 'https://api.uphold.com',
    'sandbox': 'https://api-sandbox.uphold.com'
  }
  const environment = process.env.UPHOLD_ENVIRONMENT || 'sandbox'
  const uphold = new UpholdSDK({ // eslint-disable-line new-cap
    baseUrl: upholdBaseUrls[environment],
    clientId: 'none',
    clientSecret: 'none'
  })
  // have to do some hacky shit to use a personal access token
  uphold.storage.setItem('uphold.access_token', process.env.UPHOLD_ACCESS_TOKEN)
  const donorCardId = process.env.UPHOLD_DONOR_CARD_ID

  await uphold.createCardTransaction(donorCardId,
    {'amount': desired, 'currency': 'BAT', 'destination': userCardId},
    true // commit tx in one swoop
  )

  do {
    response = await request(srv.listener)
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
    else if (response.body.balance === '0.0000') await timeout(500)
  } while (response.status === 503 || response.body.balance === '0.0000')
  err = ok(response)
  if (err) throw err

  t.is(Number(response.body.unsignedTx.denomination.amount), Number(desired))

  // ensure that transactions out of the restricted user card require a signature
  // by trying to send back to the donor card
  await t.throws(uphold.createCardTransaction(userCardId,
    {'amount': desired, 'currency': 'BAT', 'destination': donorCardId},
    true // commit tx in one swoop
  ))

  octets = JSON.stringify(response.body.unsignedTx)
  headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  payload = { requestType: 'httpSignature',
    signedTx: {
      body: body,
      headers: headers,
      octets: octets
    },
    surveyorId: surveyorId,
    viewingId: viewingId
  }

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .put('/v2/wallet/' + paymentId)
      .send(payload)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.false(response.body.hasOwnProperty('satoshis'))
  t.true(response.body.hasOwnProperty('altcurrency'))
  t.true(response.body.hasOwnProperty('probi'))
  response = await request(srv.listener)
    .get('/v2/registrar/viewing')
    .expect(ok)

  t.true(response.body.hasOwnProperty('registrarVK'))
  const viewingCredential = new anonize.Credential(viewingId, response.body.registrarVK)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .post('/v2/registrar/viewing/' + viewingCredential.parameters.userId)
      .send({ proof: viewingCredential.request() })
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err
  t.true(response.body.hasOwnProperty('surveyorIds'))
  const surveyorIds = response.body.surveyorIds
  t.true(surveyorIds.length >= 5)

  viewingCredential.finalize(response.body.verification)

  const votes = ['wikipedia.org', 'reddit.com', 'youtube.com', 'ycombinator.com', 'google.com']
  await Promise.all(surveyorIds.map((id, i) => {
    return request(srv.listener)
      .get('/v2/surveyor/voting/' + encodeURIComponent(id) + '/' + viewingCredential.parameters.userId)
      .expect(ok).then(response => {
        const surveyor = new anonize.Surveyor(response.body)
        const publisher = votes[i % votes.length]
        const proof = viewingCredential.submit(surveyor, {
          publisher
        })
        return request(srv.listener)
          .put('/v2/surveyor/voting/' + encodeURIComponent(id))
          .send({ proof })
          .expect(ok)
      })
  }))
})

test('integration : v2 grant contribution workflow with uphold BAT wallet', async t => {
  const srv = { listener: process.env.BAT_LEDGER_SERVER || 'https://ledger-staging.mercury.basicattentiontoken.org' }
  const personaId = uuid.v4().toLowerCase()
  const viewingId = uuid.v4().toLowerCase()

  let response = await request(srv.listener).get('/v2/registrar/persona').expect(ok)
  t.true(response.body.hasOwnProperty('registrarVK'))
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)

  const keypair = tweetnacl.sign.keyPair()
  console.log('created new ed25519 keypair')
  console.log(JSON.stringify({
    'publicKey': uint8tohex(keypair.publicKey),
    'secretKey': uint8tohex(keypair.secretKey)
  }))

  const body = {
    label: uuid.v4().toLowerCase(),
    currency: 'BAT',
    publicKey: uint8tohex(keypair.publicKey)
  }
  let octets = JSON.stringify(body)
  let headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  let payload = {
    requestType: 'httpSignature',
    request: {
      body: body,
      headers: headers,
      octets: octets
    },
    proof: personaCredential.request()
  }

  response = await request(srv.listener).post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)
  t.true(response.body.hasOwnProperty('wallet'))
  const paymentId = response.body.wallet.paymentId
  t.true(response.body.wallet.hasOwnProperty('paymentId'))
  t.true(response.body.wallet.hasOwnProperty('addresses'))
  t.true(response.body.hasOwnProperty('verification'))

  t.true(response.body.wallet.addresses.hasOwnProperty('BAT'))
  t.true(response.body.wallet.addresses.hasOwnProperty('BTC'))
  t.true(response.body.wallet.addresses.hasOwnProperty('CARD_ID'))
  t.true(response.body.wallet.addresses.hasOwnProperty('ETH'))
  t.true(response.body.wallet.addresses.hasOwnProperty('LTC'))

  personaCredential.finalize(response.body.verification)

  response = await request(srv.listener)
    .get('/v2/surveyor/contribution/current/' + personaCredential.parameters.userId)
    .expect(ok)

  t.true(response.body.hasOwnProperty('surveyorId'))
  const surveyorId = response.body.surveyorId

  t.true(response.body.hasOwnProperty('payload'))
  t.true(response.body.payload.hasOwnProperty('adFree'))
  t.true(response.body.payload.adFree.hasOwnProperty('probi'))
  // const donateAmt = new BigNumber(response.body.payload.adFree.probi).dividedBy('1e18').toNumber()
  // get available grant
  response = await request(srv.listener)
    .get('/v1/grants')
    .expect(ok)

  t.true(response.body.hasOwnProperty('promotionId'))

  const promotionId = response.body.promotionId

  // request grant
  response = await request(srv.listener)
      .put(`/v1/grants/${paymentId}`)
      .send({'promotionId': promotionId})
      .expect(ok)
  t.true(response.body.hasOwnProperty('probi'))

  const donateAmt = new BigNumber(response.body.probi).dividedBy('1e18').toNumber()
  const desired = donateAmt.toString()

  // try re-claiming grant, should return ok
  response = await request(srv.listener)
      .put(`/v1/grants/${paymentId}`)
      .send({'promotionId': promotionId})
      .expect(ok)

  do {
    response = await request(srv.listener)
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
    else if (response.body.balance === '0.0000') await timeout(500)
  } while (response.status === 503 || response.body.balance === '0.0000')
  let err = ok(response)
  if (err) throw err

  t.is(Number(response.body.unsignedTx.denomination.amount), Number(desired))

  octets = JSON.stringify(response.body.unsignedTx)
  headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  payload = { requestType: 'httpSignature',
    signedTx: {
      body: body,
      headers: headers,
      octets: octets
    },
    surveyorId: surveyorId,
    viewingId: viewingId
  }

  // console.log(payload)
  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .put('/v2/wallet/' + paymentId)
      .send(payload)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err
  t.false(response.body.hasOwnProperty('satoshis'))
  t.true(response.body.hasOwnProperty('altcurrency'))
  t.true(response.body.hasOwnProperty('probi'))

  response = await request(srv.listener)
    .get('/v2/registrar/viewing')
    .expect(ok)

  t.true(response.body.hasOwnProperty('registrarVK'))
  const viewingCredential = new anonize.Credential(viewingId, response.body.registrarVK)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .post('/v2/registrar/viewing/' + viewingCredential.parameters.userId)
      .send({ proof: viewingCredential.request() })
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('surveyorIds'))
  const surveyorIds = response.body.surveyorIds
  t.true(surveyorIds.length >= 5)

  viewingCredential.finalize(response.body.verification)

  const votes = ['wikipedia.org', 'reddit.com', 'youtube.com', 'ycombinator.com', 'google.com']
  await Promise.all(surveyorIds.map((id, i) => {
    return request(srv.listener)
      .get('/v2/surveyor/voting/' + encodeURIComponent(id) + '/' + viewingCredential.parameters.userId)
      .expect(ok).then(response => {
        const surveyor = new anonize.Surveyor(response.body)
        const publisher = votes[i % votes.length]
        const proof = viewingCredential.submit(surveyor, {
          publisher
        })
        return request(srv.listener)
          .put('/v2/surveyor/voting/' + encodeURIComponent(id))
          .send({ proof })
          .expect(ok)
      })
  }))
  // recheck old code if you want
  // for (let i = 0; i < surveyorIds.length; i++) {
  //   const id = surveyorIds[i]
  //   response = await request(srv.listener)
  //     .get('/v2/surveyor/voting/' + encodeURIComponent(id) + '/' + viewingCredential.parameters.userId)
  //     .expect(ok)

  //   const surveyor = new anonize.Surveyor(response.body)
  //   response = await request(srv.listener)
  //     .put('/v2/surveyor/voting/' + encodeURIComponent(id))
  //     .send({'proof': viewingCredential.submit(surveyor, { publisher: votes[i % votes.length] })})
  //     .expect(ok)
  // }
})