const Joi = require('joi')

const utils = require('../../bat-utils')
const braveHapi = utils.extras.hapi

const v1 = {}

/*
   GET /v1/rates
 */

v1.read = { handler: (runtime) => {
  return async (request, reply) => {
    const {
      altrates,
      fxrates,
      rates,
    } = runtime.currency;
    reply({
      altrates,
      fxrates,
      rates,
    })
  }
},

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Report currency rates',
  tags: [ 'api' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown()
  },

  response: { schema: Joi.any().description('all the rates') }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/rates').config(v1.read)
]

module.exports.initialize = async (debug, runtime) => {
  v1.read.response.schema = runtime.currency.schemas.rates
}
