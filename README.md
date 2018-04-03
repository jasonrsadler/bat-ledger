# bat-ledger
BAT back-end servers (ledger, eyeshade, balance, and helper)

## Initialization
Authentication is achieved via a GitHub [OAuth application](https://github.com/settings/developers). Create a developer application with an authorization callback of the form `https://{DOMAIN:PORT}/v1/login`.  Set the environment variables `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` to those corresponding in your OAuth application.

Authorization is achieved by verifying that the user is a member of a GitHub organization, i.e., `https://github.com/orgs/{ORGANIZATION}/teams`.  Set the `GITHUB_ORG` environment variable to this address.

## Setup
1. Clone the repo: `git clone https://github.com/brave-intl/bat-ledger.git`
2. Install CMake: `brew update && brew install cmake`
3. Install Redis: `brew install redis`
4. Install MongoDB: `brew install mongodb`
5. Set MongoDB URI env variable: `export MONGODB_URI=localhost/test`
6. Install the dependencies `npm install`
7. Start Redis `brew services start redis`
8. Start MongoDB `brew services start mongodb`
9. Start with `npm run start-[balance|collector|extractor|eyeshade|helper|ledger]`

If you get an error when starting a service, try clearing the Redis database:
```
redis-cli
  > flushdb
```

## Running locally with docker-compose

First, [install docker and docker compose](https://docs.docker.com/compose/install/).

Check out https://github.com/brave-intl/bat-ledger

You can add any environment variables that need to be set by creating a `.env`
file at the top of the repo. Docker compose will automatically load from this
file when launching services.

e.g. you might have the following in `.env`:
```
PUBLISHERS_TOKEN=foo
PUBLISHERS_URL=http://docker.for.mac.localhost:3000
```

```
# Build the base image:
docker-compose build

# (Optional) Build the bat-go image according to instructions @ https://github.com/brave-intl/bat-go

# 1. If you built bat-go you can then bring up all services (ledger, eyeshade, balance and grant)
docker-compose up

# 2. If you did not build bat-go, limit the services being brought up to exclude the grant service
docker-compose up ledger-web ledger-worker eyeshade-web eyeshade-worker balance-web

# Logs from all services presented interleaved, you can press ctrl-c to stop.
# Ledger listens on port 3001, eyeshade on 3002, and balance on 3003

# Note you can run any subset of services (e.g. only eyeshade)
docker-compose up eyeshade-web eyeshade-worker

# You can also launch and run services in the background
docker-compose up -d eyeshade-web eyeshade-worker

# And stop running background services with
docker-compose stop
```

### Configuration
Configuration variables are stored as environment preferences. See `config.js` for a list of these variables for ledger, eyeshade, balance, and helper respectively.

If you intend to run eyeshade in communication with the [publisher's website](https://github.com/brave-intl/publishers), you will need to set the `UPHOLD_CLIENT_ID` and `UPHOLD_CLIENT_SECRET` environment variables to the same as those used on your copy of the publishers site.

### StandardJS
For linting we use StandardJS. It's recommended that you install the necessary IDE plugin. Since this repo uses ES7 features, you'll need a global install of both the standard and babel-eslint packages.

### Troubleshooting and Building
make sure your postgres password is
```bash
# building the docker image
docker-compose build
# if you receive the following error
# unauthorized: incorrect username or password
# try logging out first with
docker logout
# then build again
```
```bash 
# if you're running into issues with the grant server
cd ~/go/src/github.com/brave-intl/bat-go
make docker
```
```bash
# surveyor creation
curl -X POST --header 'Authorization: Bearer foobarfoobar' --header 'Content-Type: application/json' --header 'Accept: application/json' -d '{"adFree":{"fee":{"USD":5},"votes":5,"altcurrency":"BAT","probi":"27116311373482831368"}}' 'http://127.0.0.1:3001/v2/surveyor/contribution'
```
```bash
# grants creation
curl -X POST --header 'Authorization: Bearer foobarfoobar' --header 'Content-Type: application/json' --header 'Accept: application/json' -d '{"grants": [ "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJhNDMyNjg1My04NzVlLTQ3MDgtYjhkNS00M2IwNGMwM2ZmZTgiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.8M5dpr_rdyCURd7KBc4GYaFDsiDEyutVqG-mj1QRk7BCiihianvhiqYeEnxMf-F4OU0wWyCN5qKDTxeqait_BQ", "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI1MGJiNzA3NS0yYzU4LTQ1NzMtYmRjYi1jZWUxYTcyZjc5NTUiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.UsHkLTqfIeb26wwECrjueTiSQqQwutf8UfuIpvhlhEb3byd5vK4WTEdpIPD3VV4v0T4SnjB8L4U-c7nRjH4DBg", "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJiZDJmMWZmOC01YTUyLTQ1YmEtYTEwYy0wMjkzM2FlNTgwNzciLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.QIMTljjo2_qSdx8gf6vyw2CSC2vEqPE5f8g8YUKdQAOJX1NWBmN8D3si_Uiukd5MGOJZXIhv0O1Ifzwo-V62DQ", "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiIyNzk0OWIzYy00ZDkxLTQxOGEtYThmNS0xMjhjZTM2NWNmMzEiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.cMu1uSuCzkyCWq9NeMwH9PhZd8-5knb7h3NMrAGEHhm9Rj6dbbiZoT4LMD9OyRsSZQ8WKzEp98JTCtBCa3h-AA", "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI0NGU5ZWY4MS02NDEzLTQ3ODQtYTYyNS00ZjAzYjE1MTQ1ZWIiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.8ddsW_LoKoc0kPU1aD8m8AZym3l2dW92NHceAUF6FyuNumqwjWTV3fF_eRwMiz6cWmgysWnJKfang9fApIysDw", "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJiNjkwM2M2ZS1lOTUxLTRmMWYtYjMxMy1mZTE5MTQyOGY3MzMiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.jWXyiCmw5Wqjt2j8UXtjBND1dxLlOzIV_4GOStZdkfzzMHWjvzy7wBjvfn3a7vseYL_xQObQ0lq2DoqIkmhWCQ", "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI5NmYwNjFlNy1iMmFkLTQxMWEtOWY5MS05OTdmNDA1OGY1OTQiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.Uy4leYMUfexPifxKKGQQf7TP9JYQAbSNEccl-vX8A_uJ-4DBFOCUF1QpOeitRFBFC0pmJKIcg1viwSFN-d3vDQ", "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI0MDZlYjkxMy00MjA0LTRmNjYtOWZiYi1lMDYzMmYxNzIyNzQiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.e2N5f6oqcCV9_Aa-K91V0xqCh80wprKsrusTQVHHdteVrkXz_wfLOa7daRU0TJJbeLy27rwFQn3tCsAxvluiCg", "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJhODQ1NWE0OS1kNDVkLTRkYTgtOGNiYS1jNTFlYWJmNGVlNDMiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.mTQDcLzUwsKdjwZi4d1zq-hbiYt684FSS_putmql9SqEpT9NaUSjvsa4CLg6LQ7aQDejfddMNOJrmQt8YhfdCw", "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI5YTJkZmZlNC00ZDI5LTQxYWUtYTE5Mi02OGMyZWMyYWMyMTciLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.wtHjXWUcJB1wbMPK6CTCQYgNNHE-ft_sm99EuPIDDKWz7bP5QEwCuhuFGQ9hVeLtr64a2_7wx6lX6TvvNUuEDw" ], "promotions": [{"active": true,"priority": 0,"promotionId": "902e7e4d-c2de-4d5d-aaa3-ee8fee69f7f3"}]}' 'http://127.0.0.1:3001/v1/grants'
```
```bash
# get into the docker mongo
docker exec -it ledger-mongo mongo
# change the db to admin
use admin
```
```bash
# start up the tests
docker-compose run --rm -v $(pwd)/test:/usr/src/app/test ledger-web npm run test-integration
```