Singularity
===========

**All your github payloads are belong to us.**

A refactored form of SnapInteractive's [Mergeatron](https://github.com/SnapInteractive/mergeatron), sitting behind an [express.js](https://github.com/visionmedia/express) application (v4.x).

Most of the functionality of Mergeatron has been preserved so please refer to the [Mergeatron documentation](https://github.com/SnapInteractive/mergeatron#configuring-mergeatron) for configuration help for either this application or a Jenkins job.

Everything else (API endpoints) can be found in [the wiki](https://github.com/behance/singularity/wiki/API-Specs). It is a work in progress so please make an issue if you have any questions!

###Main differences:

- MongoDB is the only supported DB layer (sorry - until I figure out a way to simulate a DB abstraction interface)
- persistence of configs in mongo
- data schema has a few additions
- plugins are split out into `listeners` and that's all they do. The github plugin does not contain a simple http server anymore, events are emitted to it from the application.
- various endpoints that allow users / services / applications to query data & interact with github (most importantly, merge PRs and store data for those merges).
- dynamic loading, registering & storing of repos & Jenkins jobs (with said endpoints)
- schema for the config is simplified.
- a LOT more logging (that's actually useful)
- **tests. actual. tests.**

###Running

We use [`forever`](https://github.com/nodejitsu/forever) to keep this process alive.

```
npm install -g forever
git clone git@github.com:behance/singularity.git && cd singularity
npm install
forever start server.js
```

###In Progress!
- better structuring, routing, refactoring middleware use (moving to Flatiron? Using NBD.js!)
- NSQ Daemon / Subscribing! So that configuration is even more scalable & that plugins even easier to write.
- support for multiple organizations

###TO COME && DISCLAIMER:

Please check out the [`overhaul`](https://github.com/behance/singularity/tree/overhaul) branch for the rewrite of this application! It can already take Github event payloads, check to see if the event has a status associated with it, trigger a build, mark PRs (i.e.: SHAs) with build results, retest via `issue_comment`...**all without a database!**

Only patches will be made to the current `master` branch. All other efforts / resources will be put towards achieving parity between the `master` & `overhaul` branches.

###Contributing

Feel free to contribute! Simply open up a PR and someone will review and, if up to our standards, merge.
