
// get information that a payment occurred
// user voted for various publishers (redis)
// pulling a report for publishers / surveyors
// check math
import request from 'supertest'
import test from 'ava'
import uuid from 'uuid'
import { stringify } from 'querystring'
import dotenv from 'dotenv'
import { isURL } from 'validator'
import { extras } from '../../bat-utils'
dotenv.config()
const { utils } = extras
const { requestOk, timeout } = utils
const token = 'foobarfoobar'
const eyeshadeDomain = process.env.BAT_EYESHADE_SERVER || 'https://eyeshade-staging.mercury.basicattentiontoken.org'
// const grantServer = process.env.BAT_GRANT_SERVER || 'http://127.0.0.1:3002'
const createFormURL = (pathname, params) => () => `${pathname}?${stringify(params)}`
const formSurveyorsContributionsURL = createFormURL(
  '/v1/reports/surveyors/contributions', {
    format: 'json',
    summary: false,
    excluded: false
  })
const formPublishersContributionsURL = createFormURL(
  '/v1/reports/publishers/contributions', {
    format: 'json',
    summary: true,
    balance: true,
    currency: 'USD'
  })
test('eyeshade: get json url from eyeshade server', async t => {
  t.plan(1)
  const url = formSurveyorsContributionsURL()
  const { reportURL } = await requestReportURL(url)
  const isValidUri = isURL(reportURL)
  t.true(isValidUri)
})
test.serial('eyeshade: check data from report', async t => {
  t.plan(1)
  let url = formSurveyorsContributionsURL()
  const { reportId } = await requestReportURL(url)
  const response = await fetchReport(reportId)
  const json = response.body
  const jsonHead = json[0]
  const jsonBody = json.slice(1)
  const jsonFirst = jsonBody[0]
  const {
    probi: totalProbi,
    counts: totalCounts
  } = jsonHead
  const {
    probi: scopedProbi,
    votes: scopedCountsWithoutFee
  } = jsonFirst
  const scopedProbiNumber = +scopedProbi
  const totalRatio = totalProbi / totalCounts
  const scopedCounts = scopedCountsWithoutFee / (1 / 0.95)
  const computedProbi = totalRatio * scopedCounts
  const ratio = computedProbi / scopedProbiNumber
  console.log(ratio, computedProbi, scopedProbiNumber)
  t.true(ratio > 1 && ratio < 1.001)
})
test('eyeshade: get contribution url', async t => {
  t.plan(1)
  const url = formPublishersContributionsURL()
  const { reportURL } = await requestReportURL(url)
  const isValidUrl = isURL(reportURL)
  t.true(isValidUrl)
})
test('eyeshade: get contribution data', async t => {
  t.plan(2)
  const name = 'Michael McLaughlin'
  const phone = '+1612-245-8588'
  const email = 'mmclaughlin@brave.com'
  const id1 = uuid.v4().toLowerCase()
  const id2 = uuid.v4().toLowerCase()
  const owner = `publishers#${id1}:${id2}`
  const ownerEmail = email
  const ownerName = 'Michael McLaughlin'
  const status = true
  const authorizer = { owner, ownerEmail, ownerName }
  const contactInfo = { name, phone, email }
  const authorization = `Bearer ${token}`
  const providers = [{
    publisher: owner,
    show_verification_status: status
  }]
  const payload = { authorizer, contactInfo, providers }

  const res1 = await request(eyeshadeDomain)
    .post('/v1/owners')
    .set('Authorization', authorization)
    .send(payload)
    .expect(requestOk)
  const { status: statusCode } = res1
  t.true(statusCode === 200)

  const url = formPublishersContributionsURL()
  const bod = await requestReportURL(url)
  const { reportId } = bod
  const res2 = await fetchReport(reportId)
  const { body: body2 } = res2
  console.log('contribution data', reportId, body2)
  const isArray = Array.isArray(body2)

  t.true(isArray)
})

async function eyeshadeGET ({ url, domain, expect }) {
  const host = domain || eyeshadeDomain
  const authorization = `Bearer ${token}`
  return request(host)
    .get(url)
    .set('Authorization', authorization)
}

async function fetchReport (reportId) {
  let url = `/v1/reports/file/${reportId}`
  return tryAfterMany(5000,
    () => eyeshadeGET({ url }),
    (e, result) => {
      const { statusCode } = result
      if (statusCode < 400) {
        return false
      }
      const tryagain = statusCode === 404
      if (!tryagain) {
        throw result
      }
      return tryagain
    })
}

async function requestReportURL (url) {
  let response = await eyeshadeGET({
    url,
    expect: true
  })
  let { body } = response
  return body
}
// write an abstraction for the do while loops
async function tryAfterMany (ms, theDoBlock, theCatchBlock) {
  let tryagain = null
  let result = null
  do {
    tryagain = false
    try {
      result = await theDoBlock()
      tryagain = theCatchBlock(null, result)
    } catch (e) {
      tryagain = theCatchBlock(e, result)
    }
    if (tryagain) {
      await timeout(ms)
    }
  } while (tryagain)
  return result
}
