const gulp = require('gulp')
const { setCurrentConfig } = require('./config')
require('./gulpfile')
const { promisify } = require('util')
const everySeries = require('async/everySeries')
const { execFileSync } = require('child_process')
const { postSlackMessage, updateSlackMessage } = require('./util')
const CronJob = require('cron').CronJob

const every = promisify((list, task, cb) => {
  everySeries(list, task, function (err, result) {
    cb(err, result)
  })
})

const start = promisify((task, cb) => gulp.series(task)(cb))

const updateDEM = ['dem:update']
const updateOSM = ['osm:update']
const updateGTFS = ['gtfs:dl', 'gtfs:fit', 'gtfs:filter', 'gtfs:id']

let routers
if (process.env.ROUTERS) {
  routers = process.env.ROUTERS.replace(/ /g, '').split(',')
} else {
  routers = ['finland', 'waltti', 'hsl']
}

start('seed').then(() => {
  process.stdout.write('Seeded.\n')
  if (process.argv.length === 3 && process.argv[2] === 'once') {
    process.stdout.write('Running update once.\n')
    update()
  } else {
    const cronPattern = process.env.CRON || '0 0 3 * * *'
    process.stdout.write(`Starting timer with pattern: ${cronPattern}\n`)
    new CronJob(cronPattern, update, null, true, 'Europe/Helsinki') // eslint-disable-line
  }
}).catch((err) => {
  process.stdout.write(err + '\n')
  process.exit(1)
})

async function update () {
  const slackResponse = await postSlackMessage('Starting data build')
  if (slackResponse.ok) {
    global.messageTimeStamp = slackResponse.ts
  }

  setCurrentConfig(routers.join(',')) // restore used config

  await every(updateDEM, function (task, callback) {
    start(task).then(() => { callback(null, true) })
  })

  for (let i = 0; i < 3; i++) {
    global.blobSizeOk = false // ugly hack but gulp does not return any values from tasks
    global.OTPacceptsFile = false

    await every(updateOSM, function (task, callback) {
      start(task).then(() => { callback(null, true) })
    })
    if (global.blobSizeOk) {
      break
    }
    if (i < 2) {
      // sleep 10 mins before next attempt
      await new Promise(resolve => setTimeout(resolve, 600000))
    }
  }

  if (!global.OTPacceptsFile) {
    postSlackMessage('OSM data update failed, using previous version :boom:')
  }

  await every(updateGTFS, function (task, callback) {
    start(task).then(() => { callback(null, true) })
  })

  await every(routers, function (router, callback) {
    setCurrentConfig(router)
    start('router:buildGraph').then(() => {
      try {
        process.stdout.write('Executing deploy script.\n')
        execFileSync('./deploy.sh', [router],
          {
            env:
              {
                DOCKER_USER: process.env.DOCKER_USER,
                DOCKER_AUTH: process.env.DOCKER_AUTH,
                DOCKER_TAG: process.env.DOCKER_TAG,
                TEST_TAG: process.env.OTP_TAG || '',
                TOOLS_TAG: process.env.TOOLS_TAG || '',
                SKIPPED_SITES: process.env.SKIPPED_SITES || ''
              },
            stdio: [0, 1, 2]
          }
        )
        // Update parent message to state OK if everything went okay
        if (messageTimeStamp) {
          updateSlackMessage(`${router} data updated. :white_check_mark:`)
        }
      } catch (E) {
        // If an error occurs, reply with error message to thread and update parent message to state NOT OK
        if (messageTimeStamp) {
          postSlackMessage(`${router} data update failed: ` + E.message)
          updateSlackMessage('Something went wrong with the data update. More information in the reply. :boom:')
        }
      }
      callback(null, true)
    })
  })
}
