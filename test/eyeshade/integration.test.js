
// get information that a payment occurred
// user voted for various publishers (redis)
// pulling a report for publishers / surveyors
// check math
import BigNumber from 'bignumber.js';
import UpholdSDK from '@uphold/uphold-sdk-javascript';
import anonize from 'node-anonize2-relic';
import crypto from 'crypto';
import request from 'supertest';
import test from 'ava';
import tweetnacl from 'tweetnacl';
import uuid from 'uuid';
import { sign } from 'http-request-signature';
import { stringify } from 'querystring';
import { extras } from '../../bat-utils';
import dotenv from 'dotenv';
import { isURL } from 'validator';
dotenv.config();
const { utils } = extras;
const { requestOk, errors, timeout, } = utils;
const sharedReportURL = null;
const token = 'foobarfoobar';
const eyeshadeDomain = process.env.BAT_EYESHADE_SERVER || 'https://eyeshade-staging.mercury.basicattentiontoken.org';
const grantServer = process.env.BAT_GRANT_SERVER || 'http://127.0.0.1:3002';
const createFormURL = (pathname, params) => () => `${pathname}?${stringify(params)}`
const formSurveyorsContributionsURL = createFormURL(
  '/v1/reports/surveyors/contributions', {
    format: 'json',
    summary: false,
    excluded: false,
  })
const formPublishersContributionsURL = createFormURL(
  '/v1/reports/publishers/contributions', {
    format: 'json',
    summary: true,
    balance: true,
    currency: 'USD',
  })
test('eyeshade: get json url from eyeshade server', async t => {
  t.plan(1);
  const url = formSurveyorsContributionsURL();
  const { reportURL, reportId, } = await requestReportURL(url);
  const isValidUri = isURL(reportURL);
  t.true(isValidUri);
});
test.serial('eyeshade: get json data from completed report creation', async t => {
  t.plan(1);
  let url = formSurveyorsContributionsURL();
  const { reportURL, reportId, } = await requestReportURL(url);
  const response = await fetchReport(reportId)
  const json = response.body
  const jsonHead = json[0];
  const jsonBody = json.slice(1);
  const jsonFirst = jsonBody[0];
  const {
    probi: totalProbi,
    counts: totalCounts,
  } = jsonHead;
  const {
    probi: scopedProbi,
    votes: scopedCountsWithoutFee,
  } = jsonFirst;
  const scopedProbiNumber = +scopedProbi;
  const totalRatio = totalProbi / totalCounts;
  const scopedCounts = scopedCountsWithoutFee / (1 / 0.95);
  const computedProbi = totalRatio * scopedCounts;
  const ratio = computedProbi / scopedProbiNumber;
  console.log(ratio, computedProbi, scopedProbiNumber)
  t.true(ratio > 1 && ratio < 1.001);
});
test('eyeshade: get json url from eyeshade server', async t => {
  t.plan(1)
  const url = formPublishersContributionsURL()
  const { reportURL, } = await requestReportURL(url)
  const isValidUrl = isURL(reportURL)
  t.true(isValidUrl)
})
test('eyeshade: get json data from eyeshade server', async t => {
  t.plan(1)
  const url = formPublishersContributionsURL()
  const body = await requestReportURL(url)
  const { reportURL, reportId, } = body;
  const response = await fetchReport(reportId)
  const {
    body: responseBody,
  } = response;
  const isArray = Array.isArray(responseBody)
  t.true(isArray)
})

async function fetchReport(reportId) {
  let pathname = `/v1/reports/file/${reportId}`;
  return await tryAfterMany(5000,
    async () => {
      return await eyeshadeGET({
        url: pathname,
      });
    },
    (e, result) => {
      const { statusCode, body, } = result;
      if (statusCode < 400) {
        return false;
      }
      const tryagain = statusCode === 404;
      if (!tryagain) {
        throw result;
      }
      return tryagain;
    })
}

async function requestReportURL(url) {
  let response = await eyeshadeGET({
    url,
    expect: true,
  });
  let { body, } = response;
  return body;
}
// write an abstraction for the do while loops
async function tryAfterMany(ms, theDoBlock, theCatchBlock) {
  let tryagain = null;
  let result = null;
  do {
    tryagain = false;
    try {
      result = await theDoBlock();
      tryagain = theCatchBlock(null, result);
    } catch (e) {
      tryagain = theCatchBlock(e, result);
    }
    if (tryagain) {
      await timeout(ms);
    }
  } while (tryagain);
  return result;
}

async function eyeshadeGET({ url, domain, expect, }) {
  const host = domain || eyeshadeDomain
  const authorization = `Bearer ${token}`
  let response = request(host)
    .get(url)
    .set('Authorization', authorization)
  response === expect ? response.expect(ok) : response
  return await response
}

