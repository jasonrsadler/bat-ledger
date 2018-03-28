const Joi = require('joi')
const Netmask = require('netmask').Netmask
const l10nparser = require('accept-language-parser')
const boom = require('boom')
const underscore = require('underscore')
const uuid = require('uuid')

const utils = require('../../bat-utils')
const braveJoi = utils.extras.joi
const braveHapi = utils.extras.hapi
const braveUtils = utils.extras.utils
const whitelist = utils.hapi.auth.whitelist

const grantSchema = Joi.object().keys({
  grantId: Joi.string().guid().required().description('the grant-identifier'),
  promotionId: Joi.string().guid().required().description('the associated promotion'),
  altcurrency: braveJoi.string().altcurrencyCode().required().description('the grant altcurrency'),
  probi: braveJoi.string().numeric().required().description('the grant amount in probi'),
  maturityTime: Joi.number().positive().required().description('the time the grant becomes redeemable'),
  expiryTime: Joi.number().positive().required().description('the time the grant expires')
})

const v1 = {}
const v2 = {}

const qalist = { addresses: process.env.IP_QA_WHITELIST && process.env.IP_QA_WHITELIST.split(',') }
const { CLAIM_RATE_DISABLED, } = process.env;
const claimRate = {
  limit: 10,
  window: 24 * 60 * 60
}

if (qalist.addresses) {
  qalist.authorizedAddrs = []
  qalist.authorizedBlocks = []

  qalist.addresses.forEach((entry) => {
    if ((entry.indexOf('/') === -1) && (entry.split('.').length === 4)) {
      return qalist.authorizedAddrs.push(entry)
    }

    qalist.authorizedBlocks.push(new Netmask(entry))
  })
}

const qaOnlyP = (request) => {
  const ipaddr = whitelist.ipaddr(request)
  const { authorizedAddrs, } = qalist;
  return authorizedAddrs &&
    (authorizedAddrs.indexOf(ipaddr) === -1) &&
    (!underscore.find(qalist.authorizedBlocks, block => block.contains(ipaddr)))
}

/*
   GET /v1/promotions
 */

v1.all = { handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const promotions = runtime.database.get('promotions', debug)
    let entries, results

    if (qaOnlyP(request)) return reply(boom.notFound())

    entries = await promotions.find({}, { sort: { priority: 1 } })

    results = []
    entries.forEach((entry) => {
      if (entry.promotionId === '') return

      results.push(underscore.omit(entry, [ '_id', 'batchId', 'timestamp' ]))
    })
    reply(results)
  }
},
  description: 'See if a promotion is available',
  tags: [ 'api' ],

  validate: { query: {} },

  response: {
    schema: Joi.array().min(0).items(Joi.object().keys({
      promotionId: Joi.string().required().description('the promotion-identifier')
    }).unknown(true).description('promotion properties'))
  }
}

/*
   GET /v1/grants
 */

// from https://github.com/opentable/accept-language-parser/blob/master/index.js#L1
const localeRegExp = /((([a-zA-Z]+(-[a-zA-Z0-9]+){0,2})|\*)(;q=[0-1](\.[0-9]+)?)?)*/g

v1.read = { handler: (runtime) => {
  return async (request, reply) => {
    let candidates, entries, priority, promotion, promotionIds;
    const debug = braveHapi.debug(module, request)
    // get the query params
    const lang = request.query.lang
    const paymentId = request.query.paymentId
    const languages = l10nparser.parse(lang)
    // any active promotion that is 1 or more
    const query = { active: true, count: { $gt: 0 } }
    // get the wallets and promotions collections
    const wallets = runtime.database.get('wallets', debug)
    const promotions = runtime.database.get('promotions', debug)

    const l10n = (o) => {
      // known labels
      const labels = [ 'greeting', 'message', 'text' ]

      for (let key in o) {
        let f = {
          object: () => {
            l10n(o[key])
          },
          string: () => {
            if ((labels.indexOf(key) === -1) && !(key.endsWith('Button') || key.endsWith('Markup') || key.endsWith('Text'))) {
//            return
            }

            // TBD: localization here...
          }
        }[typeof o[key]]
        if (f) f()
      }
    }

    if (qaOnlyP(request)) return reply(boom.notFound())

    if (paymentId) {
      promotionIds = []
      const wallet = await wallets.findOne({ paymentId: paymentId })
      if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))
      if (wallet.grants) {
        wallet.grants.forEach((grant) => { promotionIds.push(grant.promotionId) })
      }
      underscore.extend(query, { promotionId: { $nin: promotionIds } })
    }

    entries = await promotions.find(query)
    if ((!entries) || (!entries[0])) return reply(boom.notFound('no promotions available'))

    candidates = []
    priority = Number.POSITIVE_INFINITY
    entries.forEach((entry) => {
      if (entry.priority > priority) return

      if (priority < entry.priority) {
        candidates = []
        priority = entry.priority
      }
      candidates.push(entry)
    })
    promotion = underscore.shuffle(candidates)[0]

    debug('grants', { languages: languages })
    l10n(promotion)

    reply(underscore.omit(promotion, [ '_id', 'priority', 'active', 'count', 'batchId', 'timestamp' ]))
  }
},
  description: 'See if a promotion is available',
  tags: [ 'api' ],

  validate: {
    query: {
      lang: Joi.string().regex(localeRegExp).optional().default('en').description('the l10n language'),
      paymentId: Joi.string().guid().optional().description('identity of the wallet')
    }
  },

  response: {
    schema: Joi.object().keys({
      promotionId: Joi.string().required().description('the promotion-identifier')
    }).unknown(true).description('promotion properties')
  }
}

/*
   PUT /v1/grants/{paymentId}
 */

v1.write = { handler: (runtime) => {
  return async (request, reply) => {
    const paymentId = request.params.paymentId.toLowerCase()
    const promotionId = request.payload.promotionId
    const debug = braveHapi.debug(module, request)
    const grants = runtime.database.get('grants', debug)
    const promotions = runtime.database.get('promotions', debug)
    const wallets = runtime.database.get('wallets', debug)
    let grant, result, state, wallet

    if (!runtime.config.redeemer) return reply(boom.badGateway('not configured for promotions'))

    const promotion = await promotions.findOne({ promotionId: promotionId })
    if (!promotion) return reply(boom.notFound('no such promotion: ' + promotionId))
    if (!promotion.active) return reply(boom.badData('promotion is not active: ' + promotionId))

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    if (wallet.grants && wallet.grants.some(x => x.promotionId === promotionId)) {
      // promotion already applied to wallet
      return reply({})
    }

    // pop off one grant
    grant = await grants.findOneAndDelete({ status: 'active', promotionId: promotionId })
    if (!grant) return reply(boom.badData('promotion not available'))

    const grantInfo = underscore.extend(underscore.pick(grant, ['token', 'grantId', 'promotionId', 'status']),
      { claimTimestamp: Date.now(), claimIP: whitelist.ipaddr(request) }
    )

    // atomic find & update, only one request is able to add a grant for the given promotion to this wallet
    wallet = await wallets.findOneAndUpdate({ 'paymentId': paymentId, 'grants.promotionId': { '$ne': promotionId } },
                            { $push: { grants: grantInfo } }
    )
    if (!wallet) {
      // reinsert grant, another request already added a grant for this promotion to the wallet
      await grants.insert(grant)
      // promotion already applied to wallet
      return reply({})
    }

    // register the users claim to the grant with the redemption server
    const payload = { wallet: underscore.pick(wallet, ['altcurrency', 'provider', 'providerId']) }
    try {
      result = await braveHapi.wreck.put(runtime.config.redeemer.url + '/v1/grants/' + grant.grantId, {
        headers: {
          'Authorization': 'Bearer ' + runtime.config.redeemer.access_token,
          'Content-Type': 'application/json',
          // Only pass "trusted" IP, not previous value of X-Forwarded-For
          'X-Forwarded-For': whitelist.ipaddr(request),
          'User-Agent': request.headers['user-agent']
        },
        payload: JSON.stringify(payload),
        useProxyP: true
      })
    } catch (ex) {
      runtime.captureException(ex, { req: request })
    }

    if (runtime.config.balance) {
      // invalidate any cached balance
      try {
        await braveHapi.wreck.delete(runtime.config.balance.url + '/v2/wallet/' + paymentId + '/balance',
          {
            headers: {
              authorization: 'Bearer ' + runtime.config.balance.access_token,
              'content-type': 'application/json'
            },
            useProxyP: true
          })
      } catch (ex) {
        runtime.captureException(ex, { req: request })
      }
    }

    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $inc: { count: -1 }
    }
    await promotions.update({ promotionId: promotionId }, state, { upsert: true })

    const grantContent = braveUtils.extractJws(grant.token)

    result = underscore.extend(underscore.pick(grantContent, [ 'altcurrency', 'probi' ]))
    await runtime.queue.send(debug, 'grant-report', underscore.extend({
      grantId: grantContent.grantId,
      paymentId: paymentId,
      promotionId: promotionId
    }, result))

    return reply(result)
  }
},
  description: 'Request a grant for a wallet',
  tags: [ 'api' ],

  plugins: {
    rateLimit: {
      enabled: !CLAIM_RATE_DISABLED,
      rate: (request) => claimRate,
    },
  },

  validate: {
    params: { paymentId: Joi.string().guid().required().description('identity of the wallet') },

    payload: Joi.object().keys({
      promotionId: Joi.string().required().description('the promotion-identifier')
    }).required().description('promotion derails')
  },

  response: {
    schema: Joi.object().keys({
      altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the grant altcurrency'),
      probi: braveJoi.string().numeric().optional().description('the grant amount in probi')
    }).unknown(true).description('grant properties')
  }
}

const grantsUploadSchema = {
  grants: Joi.array().min(0).items(
      Joi.string().required().description('the jws encoded grant')
    ).description('grants for bulk upload'),
  promotions: Joi.array().min(0).items(Joi.object().keys({
    promotionId: Joi.string().required().description('the promotion-identifier'),
    priority: Joi.number().integer().min(0).required().description('the promotion priority (lower is better)'),
    active: Joi.boolean().optional().default(true).description('the promotion status')
  }).unknown(true).description('promotions for bulk upload'))
}

/*
   POST /v1/grants
   POST /v2/grants
*/

const uploadGrants = function (runtime) {
  return async (request, reply) => {
    const batchId = uuid.v4().toLowerCase()
    const debug = braveHapi.debug(module, request)
    const grants = runtime.database.get('grants', debug)
    const promotions = runtime.database.get('promotions', debug)
    let state

    let payload = request.payload

    if (payload.file) {
      payload = payload.file
      const validity = Joi.validate(payload, grantsUploadSchema)
      if (validity.error) {
        return reply(boom.badData(validity.error))
      }
    }

    const grantsToInsert = []
    const promotionCounts = {}
    for (let entry of payload.grants) {
      const grantContent = braveUtils.extractJws(entry)
      const validity = Joi.validate(grantContent, grantSchema)
      if (validity.error) {
        return reply(boom.badData(validity.error))
      }
      grantsToInsert.push({ grantId: grantContent.grantId, token: entry, promotionId: grantContent.promotionId, status: 'active', batchId: batchId })
      if (!promotionCounts[grantContent.promotionId]) {
        promotionCounts[grantContent.promotionId] = 0
      }
      promotionCounts[grantContent.promotionId]++
    }

    await grants.insert(grantsToInsert)

    for (let entry of payload.promotions) {
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.omit(entry, ['promotionId']),
        $inc: { count: promotionCounts[entry.promotionId] }
      }
      await promotions.update({ promotionId: entry.promotionId }, state, { upsert: true })
    }

    reply({})
  }
}

v1.create =
{ handler: uploadGrants,

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Create one or more grants',
  tags: [ 'api' ],

  validate: { payload: Joi.object().keys(grantsUploadSchema).required().description('data for bulk upload') },

  payload: { output: 'data', maxBytes: 1024 * 1024 * 20 },

  response:
    { schema: Joi.object().length(0) }
}

v2.create =
{ handler: uploadGrants,

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Create one or more grants via file upload',
  tags: [ 'api' ],

  plugins: {
    'hapi-swagger': {
      payloadType: 'form',
      validate: {
        payload: {
          file: Joi.any()
                      .meta({ swaggerType: 'file' })
                      .description('json file')
        }
      }
    }
  },

  validate: { headers: Joi.object({ authorization: Joi.string().optional() }).unknown() },
  payload: { output: 'data', maxBytes: 1024 * 1024 * 20 },

  response:
    { schema: Joi.object().length(0) }
}

const cohortsAssignmentSchema = Joi.array().min(0).items(Joi.object().keys({
  paymentId: Joi.string().guid().required().description('identity of the wallet'),
  cohort: Joi.string().required().description('cohort to assign')
}).unknown(true).description('grant cohorts'))

/*
   PUT /v2/grants/cohorts
 */

v2.cohorts = { handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const wallets = runtime.database.get('wallets', debug)

    let payload = request.payload

    if (payload.file) {
      payload = payload.file
      const validity = Joi.validate(payload, cohortsAssignmentSchema)
      if (validity.error) {
        return reply(boom.badData(validity.error))
      }
    }

    for (let entry of payload) {
      await wallets.update({ 'paymentId': entry.paymentId }, { $set: { 'cohort': entry.cohort } })
    }

    return reply({})
  }
},
  description: 'Set cohort associated with grants on a wallet for testing',
  tags: [ 'api' ],
  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  plugins: {
    'hapi-swagger': {
      payloadType: 'form',
      validate: {
        payload: {
          file: Joi.any()
                      .meta({ swaggerType: 'file' })
                      .description('json file')
        }
      }
    }
  },

  validate: { headers: Joi.object({ authorization: Joi.string().optional() }).unknown() },
  payload: { output: 'data', maxBytes: 1024 * 1024 * 20 },

  response: { schema: Joi.object().length(0) }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/promotions').config(v1.all),
  braveHapi.routes.async().path('/v1/grants').config(v1.read),
  braveHapi.routes.async().put().path('/v1/grants/{paymentId}').config(v1.write),
  braveHapi.routes.async().post().path('/v1/grants').config(v1.create),
  braveHapi.routes.async().post().path('/v2/grants').config(v2.create),
  braveHapi.routes.async().put().path('/v2/grants/cohorts').config(v2.cohorts)
]
