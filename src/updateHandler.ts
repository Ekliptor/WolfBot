const path = require('path');
import * as utils from "@ekliptor/apputils";
const DEST_DIR = path.join(utils.appDir, '..', 'deploy') + path.sep

const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2));
const logger = utils.logger;
const nconf = utils.nconf
const updater = require("@ekliptor/packed-updater");

updater.setLogger(logger)

/**
 * Run the updater
 * @param callback() an optional callback that will be called if the app is ready (latest version)
 */
export function runUpdater(callback) {
    if (process.env.IS_CHILD)
        return callback && callback() // nothing to do

    if (argv.bundle === true) {
        const settings = require(path.join(DEST_DIR, 'UpdateSettings.js')); // will only exist on dev machines
        let updateOptions = {
            srcPath: utils.appDir,
            bundleDestDir: DEST_DIR,
            enforceModuleVersions: {
                "mkdirp": "^0.5.1" // fix for tar-fs
            },
            uploadSettings: settings.set.uploadSettings,
            ignorePaths: [
                path.join(utils.appDir, 'docs'),
                path.join(utils.appDir, 'temp'),
                path.join(utils.appDir, 'trades'),
                path.join(utils.appDir, 'public', 'temp')
            ]
        }
        updater.createBundle(updateOptions, (err, bundle) => {
            if (err)
                logger.error('Error creating update bundle', err)
            else
                logger.log('Created update bundle', bundle)
            process.exit(0)
        })
        return
    }
    else if (nconf.get('debug') === true || argv.debug === true) // don't update debug environment
        return callback && callback()

    let updateOptions = {
        srcPath: utils.appDir,
        updateJsonUrl: nconf.get('updateUrl'),
        download: true
    }
    updater.checkUpdates(updateOptions, (err, bundle) => {
        if (err) {
            logger.error('Error checking for updates', err)
            return callback && callback() // continue with current version
        }
        else if (bundle && bundle.newVersion === true) {
            let installOptions = {
                srcPath: utils.appDir,
                bundle: bundle
            }
            updater.installUpdate(installOptions, (err) => {
                if (err)
                    logger.error('Error installing update', err)
                process.exit(1) // this callback won't be reached if the update was installed
            })
        }
        else {
            let name = bundle && bundle.name ? bundle.name : 'unknown'
            logger.info(name + ' version is up to date')
            callback && callback()
        }
    })
}