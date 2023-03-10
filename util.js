const JSZip = require('jszip')
const fs = require('fs')
const globby = require('globby')

const request = require('request')
const { promisify } = require('util')
const promisifiedRequest = promisify(request)

/**
 * zipFile file to create
 * dir directory for source files
 * glob pattern array
 * cb function to call when done
 */
const zipWithGlob = (zipFile, glob, zipDir, cb) => {
  return globby(glob).then(paths => {
    let zip = new JSZip()

    if (zipDir !== undefined) {
      zip.folder(zipDir)
    }
    paths.forEach(file => {
      zip.file((zipDir !== undefined ? (zipDir + '/') : '') + file.split('/').pop(), fs.createReadStream(file))
    })
    zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } })
      .pipe(fs.createWriteStream(zipFile))
      .on('finish', (err) => {
        cb(err)
      })
  })
}

async function postSlackMessage(messageText, parentMessageTimeStamp) {
  try {
    const response = await promisifiedRequest({
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        headers: {
            'Authorization': `Bearer ${process.env.SLACK_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': '*/*'
        },
        json: {
            channel: process.env.SLACK_CHANNEL_ID, 
            text: messageText,
            username: `OTP data builder ${process.env.BUILDER_TYPE || 'dev'}`,
            thread_ts: parentMessageTimeStamp // either null (will be a new message) or pointing to parent message (will be a reply) 
        }
    })

    // Return the response, it contains information such as the message timestamp that is needed to reply to messages
    return response.body
  } catch(e) {
      // Something went wrong in the Slack-cycle... log it and continue build
      process.stdout.write(`Something went wrong when trying to send message to Slack: ${e}\n`)   
      return e
  }
}

async function updateSlackMessage(messageText, messageTimeStamp) {
  try {
    const response = await promisifiedRequest({
        method: 'POST',
        url: 'https://slack.com/api/chat.update',
        headers: {
            'Authorization': `Bearer ${process.env.SLACK_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': '*/*'
        },
        json: {
            channel: process.env.SLACK_CHANNEL_ID, 
            text: messageText,
            username: `OTP data builder ${process.env.BUILDER_TYPE || 'dev'}`,
            ts: messageTimeStamp
        }
    })

    // Return the response, it contains information such as the message timestamp that is needed to reply to messages
    return response.body
  } catch(e) {
      // Something went wrong in the Slack-cycle... log it and continue build
      process.stdout.write(`Something went wrong when trying to update Slack message: ${e}\n`)   
      return e
  }
}

/**
 * Compare size of a newly downloaded file (either from headers or from the downloaded file locally)
 * to the size of the local version of a file (either downloaded or seeded).
 * maxDifference should be a decimal of how much smaller the new file can be than the localFile (i.e. 0.01 = 1%).
 */
const compareSizes = (localFile, newFileSize, maxDifference) => {
  return new Promise((resolve, reject) => {
    if (newFileSize === undefined || !fs.existsSync(localFile)) {
      return resolve()
    }
    let fileSize = fs.statSync(localFile).size
    if (fileSize * (1 - maxDifference) <= newFileSize) {
      resolve()
    } else {
      process.stdout.write(`Local file size was: ${fileSize} and remote size: ${newFileSize} \n`)
      reject('end') // eslint-disable-line
    }
  })
}

module.exports = {
  zipDir: (zipFile, dir, cb) => {
    zipWithGlob(zipFile, [`${dir}/*`], undefined, cb)
  },
  zipWithGlob,
  routerDir: (config) => `router-${config.id}`,
  postSlackMessage,
  updateSlackMessage,
  compareSizes
}
