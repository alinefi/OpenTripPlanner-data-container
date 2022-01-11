const JSZip = require('jszip')
const fs = require('fs')
const globby = require('globby')

const IncomingWebhook = require('@slack/client').IncomingWebhook
const url = process.env.SLACK_WEBHOOK_URL || null
const webhook = url !== null ? new IncomingWebhook(url, { username: `OTP data builder ${process.env.BUILDER_TYPE || 'dev'}`, channel: 'topic-ci' }) : null

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

const postSlackMessage = (message) => {
  if (webhook === null) {
    process.stdout.write(`Not sending to slack: ${message}\n`)
    return
  }

  process.stdout.write(`Sending to slack: ${message}\n`)

  webhook.send(message, function (err) {
    if (err) {
      process.stdout.write(`ERROR sending to slack: ${err}\n`)
    }
  })
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
  compareSizes
}
