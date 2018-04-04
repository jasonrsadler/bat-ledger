
// courtesy of https://stackoverflow.com/questions/33289726/combination-of-async-function-await-settimeout#33292942
exports.timeout = (msec) => new Promise((resolve) => setTimeout(resolve, msec))

exports.extractJws = (jws) => {
  const payload = jws.split('.')[1]
  const buf = Buffer.from(payload, 'base64')
  return JSON.parse(buf.toString('utf8'))
}

// courtesy of https://stackoverflow.com/questions/31649362/json-stringify-and-unicode-characters#31652607
exports.utf8ify = (data) => {
  if (typeof data !== 'string') data = JSON.stringify(data, null, 2)

  return data.replace(/[\u007F-\uFFFF]/g, (c) => {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).substr(-4)
  })
}

exports.requestOk = ({ status, body, request }) => {
  if (status !== 200) {
    console.log(`status: ${status}`)
    console.log(request.url)
    console.dir(body)
    return new Error(JSON.stringify(body, null, 2).replace(/\\n/g, '\n'))
  }
}

exports.uint8tohex = (arr) => {
  return [].slice.call(arr, []).map(b => ('00' + b.toString(16)).substr(-2)).join('')
}

exports.errors = {
//   GRANTSERVER_RUNNING: `Check to make sure that the grant server is running.
// cd to ~/go/src/github.com/brave-intl/bat-go and run "./grant-server" to make sure it is running.`,
//   EYESHADE_RUNNING: `Make sure that the eyeshade server is running (npm run start-eyeshade).`,
//   EYESHADE_WORKER_RUNNING: `Make sure that the eyeshade worker is running (npm run start-eyeshade-worker).`,
  RUNNING: {
    EYESHADE: {
      SERVER: `Make sure that the eyeshade server is running (npm run start-eyeshade).`,
      WORKER: `Make sure that the eyeshade worker is running (npm run start-eyeshade-worker).`
    },
    GRANT: {
      SERVER: `Check to make sure that the grant server is running.
cd to ~/go/src/github.com/brave-intl/bat-go and run "./grant-server"`
    }
  }
}
