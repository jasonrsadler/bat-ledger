const Joi = require('joi')
const anonize = require('node-anonize2-relic')
const boom = require('boom')
const crypto = require('crypto')
const underscore = require('underscore')
const uuid = require('uuid')
const { verify } = require('http-request-signature')

const utils = require('../../bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}
const v2 = {}
const v3 = {}

let altcurrency

const server = (request, runtime) => {
  const registrarType = request.params.registrarType

  return runtime.registrars[registrarType]
}

/*
   GET /v1/registrar/{registrarType}
   GET /v2/registrar/{registrarType}
   GET /v3/registrar/{registrarType}
 */

v2.read =
{ handler: (runtime) => {
  return async (request, reply) => {
    let registrar

    registrar = server(request, runtime)
    if (!registrar) return reply(boom.notFound('unknown registrar'))

    reply(underscore.extend({ payload: registrar.payload }, registrar.publicInfo()))
  }
},

  description: 'Returns information about the registrar',
  tags: ['api'],

  validate:
  { params: {
    registrarType: Joi.string().valid('persona', 'viewing').required().description('the type of the registrar'),
    apiV: Joi.string().valid('v1', 'v2', 'v3').required().description('the api version')
  } },

  response: {
    schema: Joi.object().keys({
      registrarVK: Joi.string().required().description('public key'),
      payload: Joi.object().required().description('additional information')
    })
  }
}

/*
   PATCH /v1/registrar/{registrarType}
   PATCH /v2/registrar/{registrarType}
 */

v2.update =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const payload = request.payload || {}
    const registrars = runtime.database.get('registrars', debug)
    let keys, schema, state, registrar, validity

    registrar = server(request, runtime)
    if (!registrar) return reply(boom.notFound('unknown registrar'))

    keys = {}
    keys[altcurrency] = Joi.number().min(1).required()
    schema = {
      persona: Joi.object().keys({ adFree: Joi.object().keys({
        currency: braveJoi.string().altcurrencyCode().optional(),
        days: Joi.number().integer().min(1).max(365).required(),
        fee: Joi.object().keys(keys).unknown(true).required()
      }).unknown(true) }).required()
    }[registrar.registrarType] || Joi.object().max(0)

    validity = Joi.validate(payload, schema)
    if (validity.error) return reply(boom.badData(validity.error))

    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { payload: payload } }
    await registrars.update({ registrarId: registrar.registrarId }, state, { upsert: false })

    registrar.payload = payload
    reply(underscore.extend({ payload: payload }, registrar.publicInfo()))
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Updates a registrar',
  tags: [ 'api' ],

  validate: {
    params: {
      registrarType: Joi.string().valid('persona', 'viewing').required().description('the type of the registrar'),
      apiV: Joi.string().valid('v1', 'v2').required().description('the api version')
    },
    payload: Joi.object().optional().description('additional information')
  },

  response: {
    schema: Joi.object().keys({
      registrarVK: Joi.string().required().description('public key'),
      payload: Joi.object().required().description('additional information')
    })
  }
}

/*
   POST /v1/registrar/persona/{uId}
   POST /v2/registrar/persona/{uId}
   POST /v3/registrar/persona/{uId}
 */
const createPersona = function (runtime, apiVersion) {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const uId = request.params.uId.toLowerCase()
    const proof = request.payload.proof
    const credentials = runtime.database.get('credentials', debug)
    let response = {}
    let entry, registrar, state, verification, requestSchema, requestType

    registrar = runtime.registrars['persona']
    if (!registrar) return reply(boom.notFound('unknown registrar'))

    entry = await credentials.findOne({ uId: uId, registrarId: registrar.registrarId })
    if (entry) return reply(boom.badData('persona credential exists: ' + uId))

    requestType = request.payload.requestType
    if (apiVersion === 1) {
      requestType = 'bitcoinMultisig'
    }

    if (requestType === 'bitcoinMultisig') {
      requestSchema = Joi.object().keys({
        keychains: Joi.object().keys({ user: keychainSchema.required(), backup: keychainSchema.optional() })
      }).required()
    } else if (requestType === 'httpSignature') {
      // TODO consider moving this to a custom joi validator along with signature verif below
      requestSchema = Joi.object().keys({
        headers: Joi.object().keys({
          signature: Joi.string().required(),
          digest: Joi.string().required()
        }).required(),
        body: Joi.object().keys({
          label: Joi.string().required(),
          currency: Joi.string().required(),
          publicKey: Joi.string().required()
        }).required(),
        octets: Joi.string().optional().description('octet string that was signed and digested')
      }).required()
    }
    let validity = Joi.validate(request.payload.request, requestSchema)
    const error = validity.error
    if (error) return reply(boom.badData(error))

    if (requestType === 'httpSignature') {
      const expectedDigest = 'SHA-256=' + crypto.createHash('sha256').update(request.payload.request.octets, 'utf8').digest('base64')
      if (expectedDigest !== request.payload.request.headers.digest) return reply(boom.badData('the digest specified is not valid for the body provided'))

      validity = verify({headers: request.payload.request.headers, publicKey: request.payload.request.body.publicKey}, { algorithm: 'ed25519' })
      if (!validity.verified) {
        return reply(boom.badData('wallet creation request failed validation, http signature was not valid'))
      }
    }

    try {
      const now = underscore.now()
      verification = registrar.register(proof)
      runtime.newrelic.recordCustomEvent('register', {
        registrarId: registrar.registrarId,
        registrarType: registrar.registrarType,
        duration: underscore.now() - now
      })
    } catch (ex) {
      return reply(boom.badData('invalid registrar proof: ' + JSON.stringify(proof)))
    }

    const paymentId = uuid.v4().toLowerCase()
    const wallets = runtime.database.get('wallets', debug)
    let host, prefix, result, wallet, requestBody

    requestBody = request.payload.request

    if (apiVersion === 1) {
      requestBody = { 'keychains': request.payload.keychains }
    }

    if (requestType === 'bitcoinMultisig') {
      host = request.headers.host
      prefix = ((host.indexOf('127.0.0.1') !== 0) && (host.indexOf('localhost') !== 0))
                 ? ('https://' + host) : 'ledger-staging.mercury.basicattentiontoken.org'
      requestBody = underscore.extend(requestBody, { 'prefix': prefix, 'label': paymentId })
    }
    try {
      result = await runtime.wallet.create(apiVersion, requestType, requestBody)
      wallet = result.wallet
    } catch (ex) {
      runtime.captureException(ex, { req: request })
      debug('wallet error', { reason: ex.toString(), stack: ex.stack })
      throw ex
    }

    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $set: underscore.pick(wallet, [ 'addresses', 'provider', 'altcurrency', 'httpSigningPubKey', 'providerId' ])
    }
    await wallets.update({ paymentId: paymentId }, state, { upsert: true })

    await runtime.queue.send(debug, 'persona-report', underscore.extend({ paymentId: paymentId }, state.$set))

    underscore.extend(response, {
      wallet: { paymentId: paymentId, addresses: wallet.addresses },
      payload: registrar.payload
    })

    state = { $currentDate: { timestamp: { $type: 'timestamp' } } }
    await credentials.update({ uId: uId, registrarId: registrar.registrarId }, state, { upsert: true })

    if (apiVersion === 1) {
      if (response.wallet) {
        response.wallet = underscore.omit(underscore.extend(response.wallet, { address: response.wallet.addresses.BTC }), [ 'altcurrency', 'addresses' ])
      }
      if (response.probi) {
        response = underscore.extend(response, { satoshis: Number(response.probi) })
      }
      response = underscore.omit(response, [ 'probi' ])
    }

    reply(underscore.extend(response, { verification: verification }))
  }
}

/*
   POST /v1/registrar/viewing/{uId}
   POST /v2/registrar/viewing/{uId}
 */
const createViewing = function (runtime) {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const uId = request.params.uId.toLowerCase()
    const proof = request.payload.proof
    const response = {}
    const credentials = runtime.database.get('credentials', debug)
    let entry, registrar, state, verification

    registrar = runtime.registrars['viewing']
    if (!registrar) return reply(boom.notFound('unknown registrar'))

    entry = await credentials.findOne({ uId: uId, registrarId: registrar.registrarId })
    if (entry) return reply(boom.badData('viewing credential exists: ' + uId))

    const viewings = runtime.database.get('viewings', debug)
    let diagnostic, surveyorIds, viewing

    viewing = await viewings.findOne({ uId: uId })
    if (!viewing) return reply(boom.notFound('viewingId not valid: ' + uId))

    surveyorIds = viewing.surveyorIds || []
    if (surveyorIds.length !== viewing.count) {
      diagnostic = 'surveyorIds invalid found ' + surveyorIds.length + ', expecting ' + viewing.count +
                   ', surveyorId=' + viewing.surveyorId
      runtime.captureException(diagnostic, { req: request, extra: { viewing: uId } })

      const resp = boom.serverUnavailable(diagnostic)
      resp.output.headers['retry-after'] = '5'
      return reply(resp)
    }
    underscore.extend(response, { surveyorIds: viewing.surveyorIds })

    try {
      verification = registrar.register(proof)
    } catch (ex) {
      return reply(boom.badData('invalid registrar proof: ' + JSON.stringify(proof)))
    }

    state = { $currentDate: { timestamp: { $type: 'timestamp' } } }
    await credentials.update({ uId: uId, registrarId: registrar.registrarId }, state, { upsert: true })

    reply(underscore.extend(response, { verification: verification }))
  }
}

v2.createViewing =
{ handler: (runtime) => { return createViewing(runtime) },
  description: 'Registers a user viewing',
  tags: ['api'],

  validate: {
    params: {
      uId: Joi.string().hex().length(31).required().description('the universally-unique identifier'),
      apiV: Joi.string().valid('v1', 'v2').required().description('the api version')
    },
    payload: Joi.object().keys({
      proof: Joi.string().required().description('credential registration request')
    }).unknown(true).required()
  },

  response: {
    schema: Joi.object().keys({
      verification: Joi.string().required().description('credential registration response'),
      surveyorIds: Joi.array().min(1).items(Joi.string()).required().description('allowed surveyors')
    })
  }
}

const keychainSchema = Joi.object().keys({
  xpub: braveJoi.string().Xpub().required(),
  path: Joi.string().optional(),
  encryptedXprv: Joi.string().optional()
})

v1.createPersona =
{ handler: (runtime) => { return createPersona(runtime, 1) },
  description: 'Registers a user persona',
  tags: ['api'],

  validate: {
    params: {
      uId: Joi.string().hex().length(31).required().description('the universally-unique identifier')
    },
    payload: Joi.object().keys({
      proof: Joi.string().required().description('credential registration request'),
      keychains: Joi.object().keys({ user: keychainSchema.required(), backup: keychainSchema.optional() })
    }).unknown(true).required()
  },

  response: {
    schema: Joi.object().keys({
      verification: Joi.string().required().description('credential registration response'),
      wallet: Joi.object().keys({
        paymentId: Joi.string().guid().required().description('opaque identifier for BTC address'),
        address: braveJoi.string().base58().required().description('BTC address')
      }).optional().description('wallet information'),
      payload: Joi.object().optional().description('additional information')
    })
  }
}

v2.createPersona =
{ handler: (runtime) => { return createPersona(runtime, 2) },
  description: 'Registers a user persona',
  tags: ['api'],

  validate: {
    params: {
      uId: Joi.string().hex().length(31).required().description('the universally-unique identifier')
    },
    payload: Joi.object().keys({
      requestType: Joi.string().valid('httpSignature', 'bitcoinMultisig').required().description('the type of the request'),
      request: Joi.object().required().description('wallet registration request'),
      proof: Joi.string().required().description('credential registration request')
    }).unknown(true).required()
  },

  response: {
    schema: Joi.object().keys({
      verification: Joi.string().required().description('credential registration response'),
      wallet: Joi.object().keys({
        paymentId: Joi.string().guid().required().description('opaque identifier for BTC address'),
        addresses: Joi.object().keys({
          BTC: braveJoi.string().altcurrencyAddress('BTC').optional().description('BTC address'),
          BAT: braveJoi.string().altcurrencyAddress('BAT').optional().description('BAT address'),
          CARD_ID: Joi.string().guid().optional().description('Card id'),
          ETH: braveJoi.string().altcurrencyAddress('ETH').optional().description('ETH address'),
          LTC: braveJoi.string().altcurrencyAddress('LTC').optional().description('LTC address')
        })
      }).optional().description('wallet information'),
      payload: Joi.object().optional().description('additional information')
    })
  }
}

v3.createPersona =
{ handler: (runtime) => { return createPersona(runtime, 3) },
  description: 'Registers a user persona',
  tags: ['api'],

  validate: v2.createPersona.validate,

  response: {
    schema: Joi.object().keys({
      verification: Joi.string().required().description('credential registration response'),
      wallet: Joi.object().keys({
        paymentId: Joi.string().guid().required().description('opaque identifier for BTC address'),
        addresses: Joi.object().keys({
          BAT: braveJoi.string().altcurrencyAddress('BAT').optional().description('BAT address'),
          ETH: braveJoi.string().altcurrencyAddress('ETH').optional().description('ETH address'),
          CARD_ID: Joi.string().guid().optional().description('Card id')
        }).unknown(true)
      }).optional().description('wallet information'),
      payload: Joi.object().optional().description('additional information')
    })
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/{apiV}/registrar/{registrarType}').config(v2.read),
  braveHapi.routes.async().patch().path('/{apiV}/registrar/{registrarType}').config(v2.update),
  braveHapi.routes.async().post().path('/v1/registrar/persona/{uId}').config(v1.createPersona),
  braveHapi.routes.async().post().path('/v2/registrar/persona/{uId}').config(v2.createPersona),
  braveHapi.routes.async().post().path('/v3/registrar/persona/{uId}').config(v3.createPersona),
  braveHapi.routes.async().post().path('/{apiV}/registrar/viewing/{uId}').config(v2.createViewing)
]

module.exports.initialize = async (debug, runtime) => {
  const configurations = process.env.REGISTRARS || 'persona:1,viewing:2'
  const registrars = runtime.database.get('registrars', debug)
  let entry, i, payload, registrar, registrarId, registrarType, service, services, state

  altcurrency = runtime.config.altcurrency || 'BAT'

  runtime.registrars = []

  services = configurations.split(',')
  for (i = services.length - 1; i >= 0; i--) {
    service = services[i].split(':')
    registrarType = service[0]
    registrarId = parseInt(service[1], 10)

    entry = await registrars.findOne({ registrarId: registrarId })
    if (entry) {
      if (entry.registrarType !== registrarType) {
        throw new Error('registrar #' + registrarId + ': mismatch, expecting ' + registrarType + ', found ' +
                        entry.registrarType)
      }
      registrar = new anonize.Registrar(entry.parameters)
      payload = entry.payload
    } else {
      registrar = new anonize.Registrar()
      payload = (registrarType === 'persona') ? { adFree: { fee: { USD: 5.00 }, days: 30 } } : {}
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend({ registrarType: registrarType, payload: payload }, registrar)
      }
      await registrars.update({ registrarId: registrarId }, state, { upsert: true })
    }

    registrar.registrarId = registrarId
    registrar.registrarType = registrarType
    registrar.payload = payload
    runtime.registrars[registrarType] = registrar
  }
}
