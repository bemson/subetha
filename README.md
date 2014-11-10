# SubEtha

PubSub over windows

version 0.0.0-alpha
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

The other half of the transport mechanism are the protocols employed towards message integrity, security, and routing. Bridges perform an initial handshake, in order to establish a secure connection, and encodes outgoing messages to discourage sniffing. Clients must authenticate with a Bridge, before using a **network** (i.e., the _origin_ of the iframe url), and can only message **peers** in their specific **channel**.

This module works with two complimentary modules, having their own repositories:

  * [SubEtha-Bridge](https://github.com/bemson/subetha-bridge)
  * [SubEtha Adhoc-Exchange](https://github.com/bemson/subetha-client-ax)


## Usage

SubEtha is the primary module used by your application code. This module provides classes for connecting to a given channel and communicating with peers.

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
    console.log('Received "%s" from %s, on %s', e.type, e.peer.domain, e.sent);
  });
```

Now that your client is ready to "talk", connect to a channel and network using the `#open()` method. Pass it a string, formatted as _channel@url, where _channel_ is an arbitrary identifier, and _url_ is a url or alias to one (defined in `Subetha.urls`). By default, clients connect to "lobby@local", or the "lobby" channel of the "local" url.

```js
myClient.open('ecart'); // same as "ecart@local"
```

Once a connection is established, you'll be able to access and communicate with your channel peers. Peers are represented as `Subetha.Peer` instances in the `client.peers` member. (Peer event subscribers can access the _sending_ peer, as the `event.peer` member of the event-object.)

When done communicating, close the client connection. As a best practice, detach all event subscribers if you expect to discard your instance. (Invoke `off()` with no arguments.)

```js
myClient.close();

if (allDone) {
  // detach all subscribers
  myClient.off();
}
```

#### Defining an exchange

SubEtha comes bundled with the Ad Hoc-Exchange plugin (or AX), for establishing stateful event logic. When you define an exchange, you're describing what events need to be passed back and forth with one peer, before executing logic. This could prove valuable in a peerless network, like SubEtha.

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

See the [bemson/subetha-client-ax](https://github.com/bemson/subetha-clieint-ax) repository for more information.

### Working with Bridges

Bridges provide access to a network - specifically the url origin of the bridges iframe container - and require separately hosted files. Two bridge urls are provided by default, so you can get up and running. They're aliases, defined in `Subetha.urls` (feel free to add your own alias). All bridges use the Subetha-Bridge module.

The first bridge-alias is "local", a JavaScript url that uses the same domain as your application. The url loads a public copy of the bridge module. If you have a locally hosted copy, you can override the url with your own JavaScript url.

The second bridge-alias is "public", a publicly hosted, open-source web page that accepts any client and any channel. Eventually this bridge will captures non-critical usage information, so everyone can get a sense of SubEtha's usage.

See the [bemson/subetha-bridge](https://github.com/bemson/subetha-bridge) repository for more information.

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

SubEtha lets you send custom message types, to encapsulate and enforce logic between _known_ peers. For example, the bundled AX plugin defines an "exchange" message type, and can therefore converse with peers using the same plugin. (The built-in/default message type is "event".)

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
  this._client._transmit('boot', this.id);
};

// add handler for when this message targets a client
Subetha.msgType.boot = function (receivingClient) {
  // simply close the receiver of this message
  receivingClient.close();
};
```

The `Client#_transmit()` method sends any message type you like. (See the SubEtha or AX module source-code for more information on this method.) Keep in mind that for any custom message to work, a message handler must exist on the recieving peer.

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

Below is reference documentation for the SubEtha (Client) module. (See [bemson/subetha-client-ax](https://github.com/bemson/subetha-client-ax]) for additions from the bundled SubEtha Ad Hoc-Exchange module.)

**Note:** Instance methods are prefixed with a pound-symbol (`#`). Instance properties are prefixed with an at-symbol (`@`). Static members are prefixed with a double-colon (`::`).


### Subetha::Client

Creates a new Client instance.

```
var client = new Subetha.Client();
```

This class inherits from `Subetha.EventEmitter`.

##### Client event object

Client events are messages sent by other peers (via the `Peer#send()` and `Client#send()` methods). Callbacks receive the following normalized _event object_, along with any additional message parameters.

  * `data` - Array of additional message parameters given.
  * `id` - Unique identifier for this message.
  * `peer` - The peer that sent this message.
  * `sent`:  The time (as a Date instance) when the message was sent
  * `timeStamp`: The time (in milliseconds) when the event occurred.
  * `type` - The event type of this message.

##### Network events

Instances fire the following _network_ events - as opposed to _client_ events - prefixed by a double-colon (`::`). Network events do not pass a common event object, like with client events.

  * **::connect** - Triggered when a connection is established.
  * **::disconnect** - Triggered when the client connection ends.
  * **::drop** - Triggered when a peer leaves the channel.
    * `peer`: _(Peer)_ References the recently removed `Subetha.Peer` instance.
  * **::join** - Triggered when a peer joins the channel.
    * `peer`: _(Peer)_ References the newly added `Subetha.Peer` instance.
  * **::readyStateChange** - Triggered when `@state` changes. This event precedes the _::connect_ and _::disconnect_ events, respectively.
    * `newState`: _(number)_ The integer of the new state.
    * `oldState`: _(number)_ The integer of the old state.

#### Client#close()

Close the client connection.

```
client.close();
```

#### Client#emit()

Broadcast a message to channel peers.

```
client.emit(event [, args]);
```

   * **event**: _(string)_ The event to trigger. (Can not be a network event.)
   * **args**: _(mix)_ Remaining arguments to be passed as additional callback parameters.

#### Client#open()

Establish a connection to a specific channel and (bridge) url.

```
client.open([network [, credentials, ... ]);
```

  * **network**: _(string)_ The _channel_ and _bridge_ to authorize, in the format "channel@url". The parsed value updates the `@channel` and/or `@url` properties.
  * **credentials**: (_mix_) Any additional arguments replace `@credentials` and are sent to the bridge.

Opening closes existing connections, unless it is the same network.

#### Client#_bridge()

A closured method that only returns a bridge handle when passed a private value. All other invocations return `false`.

#### Client#_transmit()

Sends an arbitrary message to some or all peers.

```
client._transmit(type [, peers [, data]]);
```

   * **type**: _(string)_ The message type.
   * **peers**: _(string[]|peer[])_ One or an array of recipient peers (ids or instances). When omitted or falsy, the message is broadcast to all peers.
   * **data**: _(mix)_ An arbtrary value passed to the message type handler of the recieving peer.

Returns `true` when the message is successfully sent. Otherwise `false`.

**Note:** This method should _not_ be invoked directly, but by library authors extending the SubEtha module.

#### Client@channel

A string reflecting the network channel. The default value is "lobby".

#### Client@credentials

A value sent when establishing a client connection. The `null` or `undefined` are ignored.

#### Client@id

A hash to uniquely identify this instance in a network. This property changes when establishing a (new) connection.

#### Client@state

A number reflecting the connection status. There are four possible states:

  * **0**: The _initial_ state, when there is no connection.
  * **1**: The _queued_ state, when a connection request is queued.
  * **2**: The _pending_ state, when a connection request has been sent.
  * **3**: The _ready_ state, when a connection has been established.
  * **4**: The _closing_ state, when the connection is closing.

**Note:** The _::readyStateChange_ event fires when this value changes.

#### Client@url

A string reflecting the network url or alias. The default value is "local".

### Subetha::EventEmitter

Creates a new EventEmitter instance.

```
var eventer = new Subetha.EventEmitter();
```

#### EventEmittter#fire()

Triggers callbacks, subscribed to this event.

```
eventer.fire(event [, args, ... ]);
```

   * **event**: _(string)_ The event to trigger.
   * **args**: _(mix)_ Remaining arguments that should be passed to all attached callbacks.

#### EventEmittter#on()

Subscribe a callback to an event.

```
eventer.on(event, callback [, scope]);
```

   * **event**: _(string)_ An arbitrary event name.
   * **callback**: _(function)_ A callback to invoke when the event is fires.
   * **scope**: _(object)_ An object to scope the callback invocation. By default, this is the EventEmitter instance.

#### EventEmittter#off()

Unsubscribe callback(s) from an event. When invoked with no arguments, all subscriptions are removed.

```
eventer.off([event [, callback [, scope]]]);
```

   * **event**: _(string)_ The event to unsubscribe. When omitted, all event subscribers are removed.
   * **callback**: _(function)_ The callback to detach from this event. When omitted, all callbacks are detached from this event.
   * **scope**: _(object)_ Specifies detaching the given callback that is _also_ scoped to the given object. Do not use, unless you attached a callback with a particular scope.

### Subetha::Peer

Creates a new Peer instance. This class is _not_ meant for direct instantiation.

```
var peer = Subetha.Peer(cfg, client);
```

  * **cfg**: _(object)_ Configuration values for peer properties.
  * **client**: _(Client)_ The client instance that will reference this peer.

#### Peer#send()

Send an event to this peer.

```
peer.send(event [, args, ... ])
```

   * **event**: _(string)_ The event to trigger. (Can not be a network event.)
   * **args**: _(mix)_ Remaining arguments to be passed as additional callback parameters.

#### Peer@channel

A string reflecting the network channel.

#### Peer@id

A hash to uniquely identify this peer in a network.

#### Peer@origin

The url origin of the web page hosting the peer.

#### Peer@start

A `Date` instance indicating when the peer joined the network.

### Subetha::guid()

Returns a unique hash of characters.

```
var hash = Subetha.guid();
```

### Subetha::bridgeTimeout

The number of milliseconds to wait before aborting a connection attempt. The default value is `8000` or eight seconds.

### Subetha::msgType

Hash of message handling functions, keyed by the message type they handle. (For instance, a built-in type is "event", for handling event messages.) This property is meant for library authors, extending the SubEtha module.

Below is the call signature passed to message handlers.

  * **client** - The recipient client, targeted by this message.
  * **peer** - The peer that sent the message.
  * **event** - A unique event object, to use as a base for this message and client.
    * `id`: The message identifier
    * `peer`: The Peer instance that sent this message
    * `sent`:  The time (as a Date instance) when the message was sent
    * `timeStamp`: The time (in milliseconds) when the event occurred
  * **data** - The message data, as sent via `#_transmit()` by the peer.
  * **payload** - The entire client message, as received on the network.

Below is the JSON structure of the _payload_ argument.

```
{                         // payload
  mid: <guid>,            // payload id
  type: "client",         // payload class
  sent: <date>,           // send date
  msg: {                  // payload message
    from: <guid>,         // peer id
    to: [<guid>, ...],    // client id(s)
    type: <message-type>, // message type
    data: <message-data>  // message data
  }
}
```

### Subetha::protocol

The [SemVer](http://semver.org) compatible version of the SubEtha protocol supported by this module.

### Subetha::urls

Hash of urls keyed by an alias. This collection is used to resolved the client url when establishing a connection. The default members are:

  * `local`: A JavaScript URL that loads a publicly hosted copy of Subetha.
  * `public`: A publicly hosted bridge.

### Subetha::version

The [SemVer](http://semver.org) compatible version of this module.


## Installation

SubEtha works within, and is intended for, modern JavaScript browsers. It is available on [bower](http://bower.io/search/?q=subetha), [component](http://component.github.io/) and [npm](https://www.npmjs.org/package/subetha) as a [CommonJS](http://wiki.commonjs.org/wiki/CommonJS) or [AMD](http://wiki.commonjs.org/wiki/Modules/AsynchronousDefinition) module.

If a SubEtha isn't compatible with your favorite runtime, please file an issue or pull-request (preferred).

### Dependencies

SubEtha depends on the following modules:

  * [Morus](https://github.com/bemson/morus)
  * [SubEtha Ad Hoc-Exchange Plugin](https://github.com/bemson/subetha-client-ax)

SubEtha also uses the following ECMAScript 5 and HTML 5 features:

  * [JSON.parse](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse)
  * [JSON.stringify](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
  * [localStorage](http://diveintohtml5.info/storage.html)
  * [postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window.postMessage)

You will need to implement shims for these browser features in unsupported environments. Note however that postMessage and localStorage shims will only allow this module to run without errors, not work as expected.

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