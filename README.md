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

Update your package.json file to add a durable-update attribute with configuration to customize the update process on your project to your needs.

Below is the default configuration:

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

### order

An array of enumerated strings representing each type of dependency found in the package manifest.

<table>
    <tr><th>Value</th><th>Definition</th></tr>
    <tr><td>standard</td><td>refers to dependencies in package manifest</td></tr>
	<tr><td>dev</td><td>refers to devDependencies in package manifest</td></tr>
	<tr><td>optional</td><td>refers to optionalDependencies in package manifest</td></tr>
</table>

### targetVersion

For each dependency type denoted by the `order` enumeration, one can specify the target version to which to update a given dependency of that type.

````javascript
{
  tag : ...,
  semver : ...,
}

````
#### tag

<table>
    <tr><th>Value</th><th>Definition</th></tr>
    <tr><td>stable</td><td>refers to the latest stable version that is published</td></tr>
	<tr><td>latest</td><td>refers to the absolute latest version that is published, even if it is considered experimental</td></tr>
</table>

#### semver

<table>
    <tr><th>Value</th><th>Definition</th></tr>
    <tr><td>exact</td><td>specifies that the dependency semver should be exact (e.g: 0.1.2)</td></tr>
	<tr><td>minimum</td><td>specifies that the dependency semver should be at least a certain version (e.g: ^0.1.2)</td></tr>
	<tr><td>loose</td><td>specifies that the dependency semver should be any patch increment version (e.g: `~0.1.2)</td></tr>
</table>

### upgradeType

How many dependencies to update in a single run

<table>
    <tr><th>Value</th><th>Definition</th></tr>
    <tr><td>single</td><td>will cause durable-update to finish after successfully updating a single dependency</td></tr>
	<tr><td>all</td><td>will cause durable-update to finish after successfully attempting to update all dependencies</td></tr>
</table>

### onFailure

What action to take on a failed dependency update

<table>
    <tr><th>Value</th><th>Definition</th></tr>
    <tr><td>about</td><td>will cause durable-update exit on the first failed dependency update</td></tr>
	<tr><td>skip</td><td>will cause durable-update to skip any failed dependency update</td></tr>
</table>

### testCommands

An Array of commands that need to be run in order to thoroughly test the package. The failure (non-zero return code) of any of these commands will be treated as a failure to successfully update.

### scmCommands

An Array of commands that need to commit changes to source control management. The failure (non-zero return code) of any of these commands will be treated as a failure to successfully commit changes. Certain substitutions are supported.

#### Substitutions

<table>
    <tr><th>Value</th><th>Definition</th></tr>
    <tr><td>%message</td><td>replaced with the commit message</td></tr>
	<tr><td>%file</td><td>replaced with the filepath to a file containing the commit message</td></tr>
	<tr><td>%manifest</td><td>replaced with the filepath to the manifest file updated by durable-update</td></tr>
</table>