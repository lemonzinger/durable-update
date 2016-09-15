var fs = require('fs');
var cp = require('child_process');

var _ = require('lodash');
var Promise = require('bluebird');
var logger = require('winston');
var david = require('david');

// promisified methods
var readFile = Promise.promisify(fs.readFile);
var writeFile = Promise.promisify(fs.writeFile);
var getDependencies = Promise.promisify(david.getDependencies);
var getUpdatedDependencies = Promise.promisify(david.getUpdatedDependencies);

//constants
var dependencyTypes = [ 'standard', 'dev', 'optional' ];
var typeManifestMap = {
  standard : 'dependencies',
  dev      : 'devDependencies',
  optional : 'optionalDependencies'
};
var tags = [ 'stable', 'latest' ];
var semverTypes = [ 'exact', 'minimum', 'loose' ];
var semverPrefixMap = {
  exact   : '',
  minimum : '^',
  loose   : '~'
};
var upgradeTypeOptions = [ 'single', 'all' ];
var onFailureOptions = [ 'skip', 'abort' ];

var defaultConfigOptions = {
  order         : [ 'standard', 'dev', 'optional' ],
  targetVersion : {
    standard : {
      tag : 'stable',
      semver : 'minimum',
    },
    dev : {
      tag : 'stable',
      semver : 'minimum',
    },
    optional : {
      tag : 'stable',
      semver : 'minimum',
    },
  },
  upgradeType   : 'single',
  onFailure     : 'skip',
  testCommands  : [ 'npm test' ],
  scmCommands    : [ 'git commit -F %file %manifest' ]
};

function initLogging() {
  logger.remove(logger.transports.Console);
  logger.add(logger.transports.Console, {
    prettyPrint : true,
    colorize    : true
  }); 
}

function buildUpdateConfig(manifestPath) {
  logger.info('manifestPath: %s', manifestPath);
  return readFile(manifestPath, null)
    .then(JSON.parse.bind(null))
    .then(function _constructConfig(manifest) {
      return {
        manifestPath : manifestPath,
        manifest     : manifest,
        options      : _.cloneDeep(manifest['durable-update'])
      };
    })
    .then(function _validateConfig(config) {
      if (!_.isPlainObject(config.options)) {
        config.options = defaultConfigOptions;
        } else {
        if (!_.isArray(config.options.order)) {
          config.options.order = defaultConfigOptions.order;
        }
        if (!_.isPlainObject(config.options.targetVersion)) {
          config.options.targetVersion = defaultConfigOptions.targetVersion;
        } else {
          _.chain(dependencyTypes).each(function(type) {
            if (!_.isPlainObject(config.options.targetVersion[type])) {
              config.options.targetVersion[type] = defaultConfigOptions.options.targetVersion[type];
            } else {
              if (tags.indexOf(config.options.targetVersion[type].tag) < 0) {
                config.options.targetVersion[type].tag = 'stable';
              }
              if (semverTypes.indexOf(config.options.targetVersion[type].semver) < 0) {
                config.options.targetVersion[type].tag = 'minimum';
              }
            }
          });
        }
        if (upgradeTypeOptions.indexOf(config.options.upgradeType) < 0) {
          config.options.upgradeType = defaultConfigOptions.upgradeType;
        }
        if (onFailureOptions.indexOf(config.options.onFailure) < 0) {
          config.options.onFailure = defaultConfigOptions.onFailure;
        }
        if (!_.isArray(config.options.testCommands)) {
          config.options.testCommands = defaultConfigOptions.testCommands;
        }
        if (!_.isArray(config.options.scmCommands)) {
          config.options.scmCommands = defaultConfigOptions.scmCommands;
        }
      }

      if (_.isPlainObject(config.manifest.davidjs) && _.isPlainObject(config.manifest.davidjs.ignore)) {
        if (_.isArray(config.options.ignore)) {
          config.options.ignore = _.concat(config.options.ignore, config.manifest.davidjs.ignore);
        } else if (_.isArray(config.manifest.davidjs.ignore)) {
          config.options.ignore = config.manifest.davidjs.ignore;
        } else {
          config.options.ignore = [];
        }
      }
      return config;
    });
}

function _execCommand(command) {
  return new Promise(function(resolve, reject) {
    try {
      logger.verbose(command)
      var child = cp.exec(command, function _callback(error, stdout, stderr) {
        if (stderr.length > 0) {
          logger.debug('\'' + command + '\' [stderr]');
          logger.debug(stderr);
        }
        if (stdout.length > 0) {
          logger.debug('\'' + command + '\' [stdout]');
          logger.debug(stdout);
        }
        if (error) {
          logger.error('\'' + command + '\' failed', error);
          reject(error);
        }
      });
      child.on('exit', function(code) {
        logger.debug('\'' + command + '\' return code: ' + code);
        resolve(code);
      })
    } catch (error) {
      logger.error('\'' + command + '\' failed', error);
      reject(error);
    }
  });
}

function testProject(testCommands) {
  return Promise.all(Promise.mapSeries(testCommands, _execCommand))
    .then(function(returnCodes) {
      var index = _.findIndex(returnCodes, function(c) { return c != 0; });
      if (index >= 0) {
        logger.warn('test command \'' + testCommands[index] + '\' failed with return code: ' + returnCodes[index]);
        throw new Error('one or more test commands failed');
      }
    });
}


function initialProjectTest(testCommands) {
  logger.info('running baseline tests on project');
  return _execCommand('rm -rf node_modules')
    .then(_execCommand.bind(null, 'npm install'))
    .then(testProject.bind(null, testCommands))
    .then(_execCommand.bind(null, 'rm -rf node_modules'))
    .catch(function(error) {
      logger.error('running initial tests on project failed', error);
      throw error;
    })
    .then(function() {
      logger.info('running baseline tests passed');
    });
}

function buildDavidOptions(options, dependencyType) {
  var tmp ={
    dev      : (dependencyType === 'dev'),
    optional : (dependencyType === 'optional'),
    stable   : (options.targetVersion[dependencyType].tag === 'stable'),
    loose    : true,
    error    : {
      E404 : true
    }
  };
  return tmp;
}

function _getDependency(config, type) {
  logger.verbose('getting ' + type + ' dependencies');
  return getUpdatedDependencies(config.manifest, buildDavidOptions(config.options, type))
    .then(function(result) {
      logger.verbose('got ' + type + ' dependencies');
      config.options.dependencies[type] = result;
    });
}

function getOutdatedDependencyInfo(config) {
  logger.info('calculating outdated dependencies');
  logger.info('manifest: ', JSON.stringify(config.manifest, null, 2));

  config.options.dependencies = {};
  return _execCommand('npm install')
    .then(function() {
      return Promise.mapSeries(config.options.order, _getDependency.bind(null, config));
    })
    .then(function(){
      logger.info('candidate dependencies:', JSON.stringify(config.options.dependencies, null, 2));
    });
}

function prepareUpdateTasks(config) {
  if (_.chain(config.options.dependencies).map(_.keys).concat().isEmpty().value()) {
    logger.info('nothing to update');
    process.exit(0);
  }

  return _.chain(config.options.order)
    .map(function (type) {
      if (!_.isEmpty(config.options.dependencies[type])) {
        return [
          type,
          _.chain(config.options.dependencies[type])
            .toPairs()
            .map(function (dependencyPair) {
              return [ dependencyPair[0], dependencyPair[1][config.options.targetVersion[type].tag] ];
            })
            .value()
         ];
      }
    })
    .filter(_.negate(_.isEmpty))
    .map(function(typePair) {
      var type = typePair[0];
      return _.chain(typePair[1])
        .filter(function(pair) {
          return (!config.options.ignore || config.options.ignore.indexOf(pair[0]) < 0);
        })
        .map(function(pair) {
          return {
            config     : config,
            type       : type,
            dependency : pair[0],
            version    : semverPrefixMap[config.options.targetVersion[type].semver] + pair[1]
          };
        })
        .value();
    })
    .flatten()
    .value();
}

function updateDependency(task) {
  // config, type, dependency, version
  // task.config, task.type, task.dependency, task.version
  task.originalVersion = task.config.manifest[typeManifestMap[task.type]][task.dependency];
  task.manifest = _.cloneDeep(task.config.manifest);
  task.manifest[typeManifestMap[task.type]][task.dependency] = task.version;
  logger.info('updating \'' + task.type + '\' dependency \'' + task.dependency + '\' from version \'' + task.originalVersion + '\' to version \'' + task.version + '\'');
  logger.verbose('new manifest: ' + JSON.stringify(task.manifest, null, 2));
  logger.verbose('manifest file: ' + task.config.manifestPath);
  return writeFile(task.config.manifestPath, JSON.stringify(task.manifest, null, 2), { encoding: 'utf8' })
    .then(_execCommand.bind(null, 'rm -rf node_modules'))
    .then(_execCommand.bind(null, 'npm install'))
    .then(function () {
      logger.info('running tests on project');
    })
    .then(testProject.bind(null, task.config.options.testCommands))
    .then(_execCommand.bind(null, 'rm -rf node_modules'))
    .catch(function(error) {
      logger.error('updating dependency \'' + task.dependency + '\' failed', error);
      throw error;
    });
}

function processUpdateTasks(config, updateTasks) {
  return Promise.mapSeries(updateTasks, function(task, index) {
    if (config.options.upgradeType === 'single' && _.findIndex(updateTasks, ['success', true]) >= 0) {
      return task;
    }
    return updateDependency(task)
      .then(function _updateSuccess() {
        task.success = true;
        config.manifest = task.manifest;
        return task;
      })
      .catch(function _updateFailure(error) {
        var message = 'dependency ' + task.dependency + ' update to version ' + task.version + ' failed with: ' + error;
        task.success = false;
        if (config.options.onFailure === 'abort') {
          logger.error(message);
          throw error;
        }
        logger.verbose(message);
        return task;
      });
  });
}

function performScmCommit(config, tasks) {
  var message = _.chain(tasks)
    .filter([ 'success', true ])
    .map(function(task) {
      return 'Durable update of ' + task.type + ' dependency \'' + task.dependency + '\' version ' + task.originalVersion + ' >>> ' + task.version;
    })
    .join('\n')
    .value();
  var messageFile = './scm-message.txt';
  logger.info('SCM commit message: ', message);
  if (config.options.scmCommands) {
    var commands = _(config.options.scmCommands)
      .map(function(command) {
        return command.replace('%message', message)
          .replace('%manifest', config.manifestPath)
          .replace('%file', messageFile);
      })
      .value();
    logger.verbose('SCM command(s): ' + JSON.stringify(commands, null, 2));
    return writeFile(messageFile, message, { encoding: 'utf8' }) 
      .then(Promise.mapSeries.bind(null, commands, _execCommand));
  }
}

function taskPostProcessing(config, tasks) {
  return performScmCommit(config, tasks);
}

function performDurableUpdate(config) {
  return initialProjectTest(config.options.testCommands)
  .then(getOutdatedDependencyInfo.bind(null, config))
  .then(prepareUpdateTasks.bind(null, config))
  .then(processUpdateTasks.bind(null, config))
  .then(taskPostProcessing.bind(null, config))
  .catch(function _completeUpdateFailure(error) {
    logger.error('durable update failed', error);
    process.exit(1);
  })
  .then(function _completeUpdateSuccess() {
    logger.info('durable update complete');
    process.exit(0);
  });
}

module.exports = function prepareDurableUpdate(options) {
  initLogging();
  if (options.loglevel) {
    logger.level = options.loglevel;
  }
  return buildUpdateConfig(options.manifestPath)
    .then(performDurableUpdate);
};