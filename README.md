# SubEtha

PubSub over windows

by Bemi Faison


## Description

SubEtha is a JavaScript library for channel-based communication between windows and domains. Use SubEtha to send and receive asynchronous events, implement ad hoc protocols, or define your own messaging framework.

Below demonstrates how you might communicate news updates using SubEtha.

```js
var
  reporter = new Subetha.Client(),
  stories = ['Climate change reversed!', 'Hell froze over!'];

reporter.open('news@public')
  .on('::join', function (peer) {
    // make news inquiry
    peer.send('any news?');
  })
  .on('any news?', function (evt) {
    // respond to news inquiry
    evt.peer.send('latest', stories);
  })
  .on('latest', function (evt, headlines) {
    /* do something with headlines */
  });
```

### How SubEtha Works

SubEtha takes publish-subscribe beyond the window, by utilizing localStorage as an event bus. The architecture consists of **clients** and **bridges** (provided as separate libraries/modules). Clients are instantiated in your code, and bridges are loaded in iframes. Clients communicate with bridges via postMessage, and bridges relay messages to each other via localStorage.

The other half of the transport mechanism are the protocols employed towards message integrity, security, and routing. Bridges perform an initial handshake, in order to establish a secure connection that includes message encoding. Bridges then authorize Clients to communicate with **peers** on a **network** -the _origin_ of a bridge url and an arbitrary **channel**.


## Usage

SubEtha is a "roll-up" of modules which add basic networking and messaging capability to your application.

  * [SubEtha-Client](https://github.com/bemson/subetha-client)
  * [SubEtha Peer-Events](https://github.com/bemson/subetha-client-pe)
  * [SubEtha Adhoc-Exchange](https://github.com/bemson/subetha-client-ax)

As well, SubEtha works with the complimentary module [SubEtha-Bridge](https://github.com/bemson/subetha-bridge).

### Working with clients

To work with clients, first create a `Subetha.Client` instance. Clients provide a familiar event-emitter API for listening to both network and peer events.

```js
var myClient = new Subetha.Client();
```

Subscribe to some _network events_. Network events inform you of changes in the connection state, and are prefixed with a double-colon ("::").

```js
myClient
  .on('::connect', function () {
    /* set stuff up once we connect */
    this.emit('greeting', 'hello world!');
  })
  .on('::disconnect', function () {
    /* tear stuff down when we disconnect */
    this.emit('does', 'nothing', 'now');
  });
```

Subscribe to some _peer events_ (these don't have a double-colon prefix). Peer events have arbitrary names, pass an event object, and may have any number of additional arguments.

```js
myClient
  .on('foo', function (e) {
    console.log('Peer "%s" sent a message!', e.peer.id);
    e.peer.send('bar', 'plus', 'additional', 'args');
  })
  .on('bar', function (e) {
    console.log('Received "%s" from %s, on %s', e.type, e.peer.origin, e.sent);
  });
```

Now that your client is ready to "talk", connect to a channel and network using the `#open()` method. Pass it a string, formatted as _channel@url, where _channel_ is an arbitrary identifier, and _url_ is a url or alias to one (defined in `Subetha.urls`).

```js
myClient.open('ecart'); // same as "ecart@local"
```

**Note:** The default url is the "local" alias.

Once a connection is established, you'll be able to access and communicate with your channel peers. Peers are represented as `Subetha.Peer` instances in the `client.peers` member. (Peer event subscribers can access the _sending_ peer, as the `event.peer` member of the event-object.)

When done communicating, close the client connection. As a best practice, detach all event subscribers if you expect to discard your instance. (Invoke `off()` with no arguments.)

```js
myClient.close();

if (allDone) {
  // detach all subscribers
  myClient.off();
}
```

See the [Subetha Peer-Events module](https://github.com/bemson/subetha-client-pe) for more information.

#### Establishing an exchange

SubEtha comes bundled with the SubEtha Ad Hoc-Exchange module (or AX), for establishing stateful event logic. When you define an exchange, you're describing what events need to be passed back and forth with one peer, before executing logic. This could prove valuable in a peerless network, like SubEtha.

Below demonstrates using AX to vet peers before responding to an event.

```js
var trusty = new Subetha.Client().open('wild-west@public');

// set up two round exchange to flag peers
trusty
  .adhoc('yo yo!', function (convo) {
    convo.reply('who is it?!');
  })
  .adhoc('yo yo!', 'who is it?!', 'me fool!', function (convo, someAuthToken) {
    if (isTokenValid(someAuthToken)) {
      // let the peer know they are now trusted
      convo.reply('wassup!?');
      // capture result of exchange in peer
      convo.peer.trusted = true;
    } else {
      convo.end();
    }
  });

// only respond to "trusted" peers
trusty.on('gimme data', function (evt) {
  if (evt.peer.trusted) {
    evt.peer.send('data', getPriviledgedData());
  }
});
```

See the [Subetha Ad Hoc-Exchange module](https://github.com/bemson/subetha-client-ax) for more information.

### Working with Bridges

Bridges provide access to a network - specifically the url origin of the bridges iframe container - and require separately hosted files. Two bridge urls are provided by default, so you can get up and running. They're aliases, defined in `Subetha.urls` (feel free to add your own alias). All bridges use the Subetha-Bridge module.

The first bridge-alias is "local", a JavaScript url that uses the same domain as your application. The url loads a public copy of the bridge module. If you have a locally hosted copy, you can override the url with your own JavaScript url.

The second bridge-alias is "public", a publicly hosted, open-source web page that accepts any client and any channel. Eventually this bridge will captures non-critical usage information, so everyone can get a sense of SubEtha's usage.

See the [Subetha-Bridge module](https://github.com/bemson/subetha-bridge) for more information.

#### Authenticating clients

Though bridges receive lots of information about connecting clients, some may require credentials. The value of the `Client.credentials` member is passed to a bridge, when opening a connection; it's converted/wrapped as an array for submission. You may also pass credentials via the `Client#open()` method. Failed authorizations result in a _::auth-fail_ event.

```js
var client = new Subetha.Client();
client.open('club@bouncer', 18, 'please!');

console.log('credentials sent:', client.credentials); // => credentials sent: [18, "please!"]

client.on('::auth-fail', function () {
  console.log('no one under 21 allowed!');
});
```

**Note:** The example above presumes that the alias "bouncer" has been defined.

### Extending the client module

While SubEtha routes messages, and communicates with bridges privately (via a closure), the module does offer some customization. Below are the classes available on the SubEtha namespace.

  * `Subetha.Client` - The primary network agent, used to send and receive messages.
  * `Subetha.Peer` - A proxy to other clients, for referencing and communication.
  * `Subetha.EventEmitter` - A canonical event-emitter class, inherited by `Subetha.Client`.

#### Sending & receiving custom messages

The Subetha-Client module lets you send custom message types, to encapsulate and enforce logic between _known_ peers. For example, the bundled AX plugin defines a "subetha/exchange" message type, and can therefore converse with peers using the same module. Similarly, the bundled PE plugin, defines a "subetha/event" message type.

Below demonstrates defining a "boot" message type. Methods for sending this message type have been added to the Client and Peer prototypes. As well, a boot message handler has been added to the `Subetha.msgType` namespace.

```js
// add Client method for sending this custom type
Subetha.Client.prototype.kickAll = function () {
  // broadcast messages by omitting a peer id
  this._transmit('boot');
};

// add Peer method for sending this custom type
Subetha.Peer.prototype.kick = function () {
  // send message to this peer only
  this._client._transmit('boot', this);
};

// add handler for when this message targets a client
Subetha.msgType.boot = function (receivingClient) {
  // simply close the receiver of this message
  receivingClient.close();
};
```

The `Client#_transmit()` method sends any message type you like. (See the PE module for more information on this method.) Keep in mind that for any custom message to work, a corresponding message handler must exist on the recieving peer.

#### Overriding the EventEmitter

You may override the `Subetha.EventEmitter` class, to incorporate a more familiar or powerful API than what SubEtha provides. The EventEmitter class is inherited by the `Subetha.Client` class.

The code below demonstrates how to supplement SubEtha's EventEmitter with [BackBone.Events](http://documentcloud.github.io/backbone/#Events). BackBone events allow you to do interesting things, like listen to all incoming events, or unsubscribe after the event fires.

```js
_.extend(Subetha.EventEmitter.prototype, Backbone.Event);
// map `fire` to `trigger`, since SubEtha uses that method internally
Subetha.EventEmitter.prototype.fire = Backbone.Event.trigger;
```

**Note:** This example presumes you have [BackBone](http://documentcloud.github.io/backbone/) and [Underscore](http://underscorejs.org/) in your environment.


## API

API documentation is available in the repositories of the respective modules that comprise the SubEtha module.


## Installation

SubEtha works within, and is intended for, modern JavaScript browsers. It is available on [bower](http://bower.io/search/?q=subetha), [component](http://component.github.io/) and [npm](https://www.npmjs.org/package/subetha) as a [CommonJS](http://wiki.commonjs.org/wiki/CommonJS) or [AMD](http://wiki.commonjs.org/wiki/Modules/AsynchronousDefinition) module.

If a SubEtha isn't compatible with your favorite runtime, please file an issue or pull-request (preferred).

### Dependencies

SubEtha depends on the following modules:

  * [SubEtha Ad Hoc-Exchange](https://github.com/bemson/subetha-client-ax)
  * [SubEtha Peer-Events](https://github.com/bemson/subetha-client-pe)

### Web Browsers

Use a `<SCRIPT>` tag to load the _subetha.min.js_ file in your web page. The file includes SubEtha dependencies for your convenience. Doing so, adds `Subetha` to the global scope.

```html
  <script type="text/javascript" src="path/to/subetha.min.js"></script>
  <script type="text/javascript">
    // ... SubEtha dependent code ...
  </script>
```

**Note:** The minified file was compressed by [Closure Compiler](http://closure-compiler.appspot.com/).

### Package Managers

  * `npm install subetha`
  * `component install bemson/subetha`
  * `bower install subetha`

**Caution:** The npm dependencies load the Subetha-Client modules as a [peerDependency](https://www.npmjs.org/doc/files/package.json.html#peerdependencies).

### AMD

Assuming you have a [require.js](http://requirejs.org/) compatible loader, configure an alias for the SubEtha module (the term "subetha" is recommended, for consistency). The _subetha_ module exports a module namespace.

```js
require.config({
  paths: {
    subetha: 'my/libs/subetha'
  }
});
```

Then require and use the module in your application code:

```js
require(['subetha'], function (Subetha) {
  // ... SubEtha dependent code ...
});
```

**Warning:** Do not load the minified file via AMD, since it includes SubEtha dependencies, which themselves export modules. Use AMD optimizers like [r.js](https://github.com/jrburke/r.js/), in order to roll-up your dependency tree.

## Considerations

SubEtha is an **experimental project in alpha development.** Testing is non-existent. Production deploys are discouraged, and done at your own risk.

The following sub-sections express areas that are under active or planned development and/or improvement.

### Security

As a new "pipe", SubEtha intends to be as robust and secure as TCP/IP and SSL connections. However, since this is _only_ an ideal: **security is as security does.** Do not send with SubEtha, that which you do not want to share.

### Capacity

Despite localStorage allotting 5Mb per domain, SubEtha does not check or assess message size. Do **not** send base64 encoded files... yet.

### Encoding/Decoding

SubEtha currently encodes and decodes _outgoing_ messages (from bridge to the client) synchronously. Large messages will likely cause noticeable lag.

## Shout outs

 * [William Kapke-Wicks](https://github.com/williamwicks/) - Inspired me to explore [storage events](http://html5demos.com/storage-events) and published [scomm](https://github.com/williamwicks/scomm).
 * Shankar Srinivas - Original cheerleader for this (and all things non-work related).
 * [Chris Nojima](https://github.com/cnojima) - Saw the forest when I saw trees.
 * [Mathias Buus](https://github.com/mafintosh) - Random guy who suggested the random bootstrap delay.
 * [Oakland JS](http://oaklandjs.com) - One brilliant hive mind of support and ingenuity!

## License

SubEtha is available under the terms of the [Apache-License](http://www.apache.org/licenses/LICENSE-2.0.html).

Copyright 2014, Bemi Faison