const Readable = require('stream').Readable
const url = require('url')

const boom = require('boom')
const Joi = require('joi')
const underscore = require('underscore')
const uuid = require('uuid')

const utils = require('../../bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}
const v2 = {}
const v3 = {}

let altcurrency

/*
   GET /v1/reports/file/{reportId}
 */

v1.getFile = {
  handler: (runtime) => {
    return async (request, reply) => {
      const debug = braveHapi.debug(module, request)
      const reportId = request.params.reportId
      let reader, writer
      const file = await runtime.database.file(reportId, 'r')
      if (!file) return reply(boom.notFound('no such report: ' + reportId))

      reader = runtime.database.source({ filename: reportId })
      reader.on('error', (err) => {
        debug('getFile error', err)
        reply(boom.badImplementation('Sic transit gloria mundi: ' + reportId))
      }).on('open', () => {
        debug('getFile open', underscore.pick(file, [ 'contentType', 'metadata' ]))
        writer = reply(new Readable().wrap(reader))
        if (file.contentType) writer = writer.type(file.contentType)
        underscore.keys(file.metadata || {}).forEach((header) => { writer = writer.header(header, file.metadata[header]) })
      })
    }
  },

  description: 'Gets a report file',
  tags: [ 'api' ],

  validate:
    { params: { reportId: Joi.string().guid().required().description('the report identifier') } }
}

v1.publisher = {}
v1.publishers = {}
v2.publishers = {}
v3.publishers = {}

/*
   GET /v1/reports/publishers/referrals
 */

v1.publishers.referrals = {
  handler: (runtime) => {
    return async (request, reply) => {
      const amount = request.query.amount
      const authority = authorityProvider(request)
      const currency = request.query.currency.toUpperCase()
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      const threshold = runtime.currency.fiat2alt(currency, amount, altcurrency)

      await runtime.queue.send(debug, 'report-publishers-referrals',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   { threshold: threshold }, request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns information about referrals to publishers, used to prepare referral payout',
  tags: [ 'api' ],

  validate: {
    query: {
      format: Joi.string().valid('json').optional().default('json').description('the format of the report'),
      summary: Joi.boolean().optional().default(true).description('summarize report'),
      balance: Joi.boolean().optional().default(true).description('show balance due'),
      authorized: Joi.boolean().optional().default(true).description('filter on authorization status'),
      verified: Joi.boolean().optional().default(true).description('filter on verification status'),
      amount: Joi.number().integer().min(0).optional().description('the minimum amount in fiat currency'),
      currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

/*
   GET /v1/reports/publisher/{publisher}/contributions
   GET /v1/reports/publishers/contributions
 */

v1.publisher.contributions = {
  handler: (runtime) => {
    return async (request, reply) => {
      const { config, queue } = runtime
      // get the authority and use a default
      let authority = authorityProvider(request)
      // get params and query
      const { params, query } = request
      // create a new id
      const reportId = uuid.v4().toLowerCase()
      // create the path to said id
      const pathname = '/v1/reports/file/' + reportId
      // create a url object to be stringified
      const urlObject = underscore.defaults({
        pathname
      }, config.server)
      // create a report url
      const reportURL = url.format(urlObject)
      // success data queue
      const sendData = underscore.defaults({
        reportId,
        reportURL,
        authority
      }, params, query)
      // start debug block
      const debug = braveHapi.debug(module, request)
      await queue.send(debug, 'report-publishers-contributions', sendData)
      // reply with url and id
      reply({
        reportURL,
        reportId
      })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns information about contributions to a publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the report'),
      summary: Joi.boolean().optional().default(true).description('summarize report')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

v1.publishers.contributions = {
  handler: (runtime) => {
    return async (request, reply) => {
      const {
        queue,
        currency: runtimeCurrency
      } = runtime
      const { query } = request
      const {
        amount,
        currency: queryCurrency
      } = query
      // get the authority and use a default
      const authority = authorityProvider(request)
      const currency = queryCurrency.toUpperCase()
      // create a new id
      const reportId = uuid.v4().toLowerCase()
      const pathname = `/v1/reports/file/${reportId}`
      // create the url object
      const urlObject = underscore.defaults({
        pathname
      }, runtime.config.server)
      // create the full url
      const reportURL = url.format(urlObject)
      // start debug
      const debug = braveHapi.debug(module, request)
      const threshold = runtimeCurrency.fiat2alt(currency, amount, altcurrency)
      const queueData = underscore.defaults({
        reportId,
        reportURL,
        authority,
        threshold
      }, query)
      // send to the queue to be processed
      await queue.send(debug, 'report-publishers-contributions', queueData)
      // send back to the request
      reply({
        reportURL,
        reportId
      })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns information about contributions to publishers',
  tags: [ 'api' ],

  validate: {
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the report'),
      summary: Joi.boolean().optional().default(true).description('summarize report'),
      balance: Joi.boolean().optional().default(true).description('show balance due'),
      authorized: Joi.boolean().optional().description('filter on authorization status'),
      verified: Joi.boolean().optional().description('filter on verification status'),
      cohorts: Joi.array().items(braveJoi.string().token()).description('cohorts to be included in report'),
      amount: Joi.number().integer().min(0).optional().description('the minimum amount in fiat currency'),
      currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

/*
   GET /v1/reports/publisher/{publisher}/settlements
   GET /v1/reports/publishers/settlements
 */

v1.publisher.settlements = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = authorityProvider(request)
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-settlements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   request.params, request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns information about settlements to a publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the report'),
      summary: Joi.boolean().optional().default(true).description('summarize report')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

v1.publishers.settlements = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = authorityProvider(request)
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-settlements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns information about settlements to publishers',
  tags: [ 'api' ],

  validate: {
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the report'),
      summary: Joi.boolean().optional().default(true).description('summarize report')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

/*
   GET /v1/reports/publisher/{publisher}/statements
   GET /v1/reports/publishers/statements/{hash}
   GET /v2/reports/publishers/statements/{settlementId}
   GET /v2/reports/publishers/statements
 */

v1.publisher.statements = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = authorityProvider(request)
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   request.params, request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns statements for a publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { summary: Joi.boolean().optional().default(true).description('summarize report') }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

v1.publishers.statements = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = authorityProvider(request)
      const hash = request.params.hash
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   { hash: hash }, request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns statements for publishers',
  tags: [ 'api' ],

  validate: {
    params: { hash: Joi.string().hex().required().description('transaction hash') },
    query: {
      rollup: Joi.boolean().optional().default(true).description('include all settlements for associated publishers'),
      summary: Joi.boolean().optional().default(false).description('summarize report')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

v3.publishers.statements = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = authorityProvider(request)
      const settlementId = request.params.settlementId
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   { settlementId: settlementId }, request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns statements for publishers',
  tags: [ 'api' ],

  validate: {
    params: { settlementId: Joi.string().guid().required().description('transaction-identifier') },
    query: {
      rollup: Joi.boolean().optional().default(true).description('include all settlements for associated publishers'),
      summary: Joi.boolean().optional().default(false).description('summarize report')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

v2.publishers.statements = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = authorityProvider(request)
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns statements for all publishers',
  tags: [ 'api' ],

  validate: {
    query: {
      rollup: Joi.boolean().optional().default(true).description('include all settlements for associated publishers'),
      summary: Joi.boolean().optional().default(false).description('summarize report')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

/*
   GET /v1/reports/publishers/status
   GET /v2/reports/publishers/status
 */

v1.publishers.status = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = authorityProvider(request)
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-status',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns information about publisher status',
  tags: [ 'api' ],

  validate: {
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the response'),
      elide: Joi.boolean().optional().default(true).description('elide contact information'),
      summary: Joi.boolean().optional().default(true).description('summarize report'),
      verified: Joi.boolean().optional().description('filter on verification status')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

v2.publishers.status = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = 'automation'
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-status',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   { elide: true }, request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Returns information about publisher status (for automation)',
  tags: [ 'api' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the response'),
      summary: Joi.boolean().optional().default(true).description('summarize report'),
      verified: Joi.boolean().optional().description('filter on verification status')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

/*
   GET /v1/reports/surveyors/contributions
 */

v1.surveyors = {}

v1.surveyors.contributions = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = authorityProvider(request)
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)
      const queueData = underscore.defaults({
        reportId,
        reportURL,
        authority
      }, request.query)
      await runtime.queue.send(debug, 'report-surveyors-contributions', queueData)
      reply({
        reportURL,
        reportId
      })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns information about contribution activity',
  tags: [ 'api' ],

  validate: {
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the report'),
      summary: Joi.boolean().optional().default(true).description('summarize report'),
      excluded: Joi.boolean().optional().description('filter on excluded status (forces !summary)'),
      cohorts: Joi.array().items(braveJoi.string().token()).description('cohorts to be included in report')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

/*
   GET /v1/reports/grants/outstanding
 */

v1.grants = {}

v1.grants.outstanding = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = authorityProvider(request)
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-grants-outstanding',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Returns information about grant activity',
  tags: [ 'api' ],

  validate: {
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the report')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/reports/file/{reportId}').config(v1.getFile),
  braveHapi.routes.async().path('/v1/reports/publishers/referrals').config(v1.publishers.referrals),
  braveHapi.routes.async().path('/v1/reports/publisher/{publisher}/contributions').config(v1.publisher.contributions),
  braveHapi.routes.async().path('/v1/reports/publishers/contributions').config(v1.publishers.contributions),
  braveHapi.routes.async().path('/v1/reports/publisher/{publisher}/settlements').config(v1.publisher.settlements),
  braveHapi.routes.async().path('/v1/reports/publishers/settlements').config(v1.publishers.settlements),
  braveHapi.routes.async().path('/v1/reports/publisher/{publisher}/statements').config(v1.publisher.statements),
  braveHapi.routes.async().path('/v1/reports/publishers/statements/{hash}').config(v1.publishers.statements),
  braveHapi.routes.async().path('/v2/reports/publishers/statements').config(v2.publishers.statements),
  braveHapi.routes.async().path('/v3/reports/publishers/statements/{settlementId}').config(v3.publishers.statements),
  braveHapi.routes.async().path('/v1/reports/publishers/status').config(v1.publishers.status),
  braveHapi.routes.async().path('/v2/reports/publishers/status').config(v2.publishers.status),
  braveHapi.routes.async().path('/v1/reports/surveyors/contributions').config(v1.surveyors.contributions),
  braveHapi.routes.async().path('/v1/reports/grants/outstanding').config(v1.grants.outstanding)
]

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'
}

const authorityProvider = (request) => {
  const { auth } = request
  const { credentials } = auth
  const { provider, profile } = credentials
  let authority = provider
  if (process.env.NODE_ENV === 'production') {
    authority = provider + ':' + profile.username
  }
  return authority
}
