'use strict'

import anonize from 'node-anonize2-relic'
import bg from 'bitgo'
// import bitcoinjs from 'bitcoinjs-lib'
import crypto from 'crypto'
import request from 'supertest'
import test from 'ava'
import tweetnacl from 'tweetnacl'
import underscore from 'underscore'
import uuid from 'uuid'
import { sign } from 'http-request-signature'

import { extras } from '../bat-utils'
const { utils } = extras
const {
  requestOk: ok,
  uint8tohex,
  timeout: snooze
} = utils
const bitgo = new bg.BitGo({ env: 'test' })

test('transition', async t => {
  const btcSrv = { listener: process.env.LEDGER_SERVER || 'https://ledger-staging.brave.com' }
  const batSrv = { listener: process.env.BAT_LEDGER_SERVER || 'https://ledger-staging.mercury.basicattentiontoken.org' }
  const personaId = uuid.v4().toLowerCase()

  let response = await request(btcSrv.listener).get('/v1/registrar/persona').expect(ok)
  t.true(response.body.hasOwnProperty('registrarVK'))
  const btcPersonaCredential = new anonize.Credential(personaId, response.body.registrarVK)
  const keychains = { user: bitgo.keychains().create(), passphrase: 'passphrase' }

  keychains.user.encryptedXprv = bitgo.encrypt({ password: keychains.passphrase, input: keychains.user.xprv })
  keychains.user.path = 'm'
  let payload = { keychains: { user: underscore.pick(keychains.user, [ 'xpub', 'path', 'encryptedXprv' ]) },
    proof: btcPersonaCredential.request()
  }

  response = await request(btcSrv.listener).post('/v1/registrar/persona/' + btcPersonaCredential.parameters.userId)
    .send(payload).expect(ok)
  t.true(response.body.hasOwnProperty('wallet'))
  const btcPaymentId = response.body.wallet.paymentId
  const bitgoAddr = response.body.wallet.address

  console.log('btcPaymentId: ' + btcPaymentId)
  console.log('bitgoAddr: ' + bitgoAddr)

  response = await request(batSrv.listener).get('/v2/registrar/persona').expect(ok)
  t.true(response.body.hasOwnProperty('registrarVK'))
  const batPersonaCredential = new anonize.Credential(personaId, response.body.registrarVK)

  const keypair = tweetnacl.sign.keyPair()

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

  payload = { requestType: 'httpSignature',
    request: {
      body: body,
      headers: headers,
      octets: octets
    },
    proof: batPersonaCredential.request()
  }
  response = await request(batSrv.listener).post('/v2/registrar/persona/' + batPersonaCredential.parameters.userId)
    .send(payload).expect(ok)
  t.true(response.body.hasOwnProperty('wallet'))
  t.true(response.body.wallet.hasOwnProperty('paymentId'))
  const batPaymentId = response.body.wallet.paymentId

  console.log('batPaymentId: ' + batPaymentId)

  t.true(response.body.wallet.hasOwnProperty('addresses'))
  t.true(response.body.wallet.addresses.hasOwnProperty('BTC'))
  const upholdBtcAddr = response.body.wallet.addresses.BTC
  console.log('upholdBtcAddr: ' + upholdBtcAddr)

  t.true(response.body.hasOwnProperty('verification'))
  batPersonaCredential.finalize(response.body.verification)

  do {
    console.log('waiting for funding')
    response = await request(btcSrv.listener)
      .get(`/v1/wallet/${btcPaymentId}/transition/${batPaymentId}`)
    if (response.status === 503) await snooze(response.headers['retry-after'] * 1000)
    else if (response.status === 400) await snooze(5000)
  } while (response.status === 503 || response.status === 400)
  let err = ok(response)
  if (err) throw err
  console.log(response)

  const wallet = bitgo.newWalletObject({ wallet: { id: bitgoAddr } })
  const signedTx = await wallet.signTransaction({ transactionHex: response.body.unsignedTx.transactionHex,
    unspents: response.body.unsignedTx.unspents,
    keychain: keychains.user
  })
  // }, function (err, signedTx) {
    // payload = { viewingId: viewingId, surveyorId: surveyorInfo.surveyorId, signedTx: signedTx.tx }

  do {
    if (response.status === 503) {
      await snooze(response.headers['retry-after'] * 1000)
    }
    response = await request(btcSrv.listener)
      .put(`/v1/wallet/${btcPaymentId}/transition`)
      .send({ 'signedTx': signedTx.tx })
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  console.log(response)
})
