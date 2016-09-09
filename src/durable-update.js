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
var semverTypes = [ 'exact', 'minimum', 'loose' ];
var semverPrefixMap = {
  exact   : '',
  minimum : '^',
  loose   : '~'
};
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
  onFailure     : 'abort',
  testCommands  : [ 'npm test' ],
  scmCommands    : [ 'git commit -a -m "%message"' ]
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
      if (!_.isPlainObject(config.manifest['durable-update'])) {
        throw new Error('durable-update not enabled in manifest');
      }
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
              if (!_.isString(config.options.targetVersion[type].tag)) {
                config.options.targetVersion[type].tag = 'stable';
              }
              if (!_.isString(config.options.targetVersion[type].semver)) {
                config.options.targetVersion[type].tag = 'minimum';
              }
            }
          });
        }
        if (!_.isString(config.options.upgradeType)) {
          config.options.upgradeType = defaultConfigOptions.upgradeType;
        }
        if (!_.isString(config.options.onFailure)) {
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
        } else {
          config.options.ignore = config.manifest.davidjs.ignore;
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
          logger.verbose(command + ' [stderr]');
          logger.verbose(stderr);
        }
        if (stdout.length > 0) {
          logger.verbose(command + ' [stdout]');
          logger.verbose(stdout);
        }
        if (error) {
          logger.error('\'' + command + '\' failed', error);
          reject(error);
        }
      });
      child.on('exit', function(code) {
        logger.verbose(command + ' return code ' + code);
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
      if (_.findIndex(returnCodes, function(c) { return c != 0; }) >= 0) {
        throw new Error('one or more test commands failed');
      }
    });
}


function initialProjectTest(testCommands) {
  logger.info('running initial tests on project');
  return _execCommand('rm -rf node_modules')
    .then(_execCommand.bind(null, 'npm install'))
    .then(testProject.bind(null, testCommands))
    .then(_execCommand.bind(null, 'rm -rf node_modules'))
    .catch(function(error) {
      logger.error('running initial tests on project failed', error);
      throw error;
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

function getAllUpdatedDependencies(config) {
  logger.info('calculating updated dependencies');
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

function updateDependency(config, type, dependency, version) {
  var originalVersion = config.manifest[typeManifestMap[type]][dependency];
  var newManifest = _.cloneDeep(config.manifest);
  newManifest[typeManifestMap[type]][dependency] = version;
  logger.info('updating \'' + type + '\' dependency \'' + dependency + '\' from version \'' + originalVersion + '\' to version \'' + version + '\'');
  logger.verbose('new manifest: ' + JSON.stringify(newManifest, null, 2));
  logger.verbose('path: ' + config.manifestPath);
  return writeFile(config.manifestPath, JSON.stringify(newManifest, null, 2), { encoding: 'utf8' })
    .then(_execCommand.bind(null, 'rm -rf node_modules'))
    .then(_execCommand.bind(null, 'npm install'))
    .then(logger.info.bind(null, 'running tests on project'))
    .then(testProject.bind(null, testCommands))
    .then(_execCommand.bind(null, 'rm -rf node_modules'))
    .catch(function(error) {
      logger.error('updating dependency \'' + dependency.name + '\' failed', error);
      throw error;
    }).then(Promise.resolve.bind(null, originalVersion));
}

function processOutdatedDependencies(updateTasks) {
    return Promise.mapSeries(updateTasks, function(task) {
      return updateDependency(task.config, task.type, task.dependency, task.version)
        .then(function(originalVersion) {
          task.originalVersion = originalVersion;
          return true;
        })
        .catch(function(error) {
          return false;
        })
        .then(function(success) {
          if (success) {
            return Promise.reject(task);
          }
        });
    });
  }

function performScmCommit(config, task) {
  var message = 'Durable update of ' + task.type + ' dependency \'' + task.dependency + '\' version ' + task.originalVersion + ' >>> ' + task.version;
  logger.info(message);
  if (config.options.scmCommands) {
    var commands = _(config.options.scmCommands)
      .map(function(command) {
        return command.replace('%message', message).replace('%manifest', config.manifestPath);
      })
      .value();
    logger.verbose('SCM command(s): ' + JSON.stringify(commands, null, 2));
    return Promise.mapSeries(commands, _execCommand);
  }
}

function performDurableUpdate(config) {
  return initialProjectTest(config.options.testCommands)
  .then(getAllUpdatedDependencies.bind(null, config))
  .then(prepareUpdateTasks.bind(null, config))
  .then(processOutdatedDependencies)
  .then(function _done() {
    logger.info('durable update complete');
    process.exit(0);
  })
  .catch(function _handleRejection(rejection) {
    if (!(rejection instanceof Error)) {
      return rejection;
    }
    throw rejection;
  })
  .then(performScmCommit.bind(null, config))
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