# durable-update
- - -

Node.js module that allows for easy dependency management

## Usage

Install durable-update with npm

````bash
npm install --save-dev durable-update
````

Run durable-update.js

````bash
./node_modules/durable-update/bin/durable-update.js
````

## Configuration

update your package.json file to add a durable-update attribute with configuration to customize the update process on your project to your needs

````javascript
{
//  ...
  "durable-update" : {
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
      // upgradeType   : 'all',
      // onFailure     : 'abort',
      onFailure     : 'skip',
      testCommands  : [ 'npm test' ],
      scmCommands    : [ 'git commit -F %file %manifest' ]
    },
//  ...
}
````