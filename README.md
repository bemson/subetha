# SubEtha

PubSub between windows

version 0.0.0-alpha
by Bemi Faison


## Description

SubEtha is a clientside JavaScript libary for channel-based communication between routines, windows and domains. Use SubEtha to send and receive asynchronous events, implement adhoc protocols, or define your own messaging framework.

Below demonstrates how you might share news using SubEtha.

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

The other half of the transport mechanism are the protocols SubEtha uses for integrity, security, and routing. Clients authenticate with bridges before using their **network** (i.e., the _origin_ of the iframe url), and can only message **peers** in a specific **channel**. Bridges perform an initial handshake that identifies a secure sender, and messages are encoded to prevent frequency analysis.


## Usage

Using a SubEtha client _requires_ connecting to a bridge. Bridges may be hosted locally or externally, but do require targeting separate file: the bridge library. (See the [bemson/subetha-bridge]() repository, to learn about bridges.) If you are connected to the Internet, a client will attempt to load a publicly hosted file. Otherwise, you may configure the local bridge manually.

### Handling Events

To send and receive messages, create a `Subetha.Client` instance.

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

Subscribe to some _peer events_. Peer events have arbitrary names, pass an event object, and may have any number of additional arguments.

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

Connect to a specific channel and network, using the string format _channel@network_, where _channel_ is an arbitrary identifier, and _network_ is an alias or full bridge url. By default, clients use "lobby@local" - i.e., the "lobby" channel on the "local" network (an alias).

```js
myClient.open('ecart'); // same as "ecart@local"
```

When done communicating, close the client connection. (Be sure to detach all event subscribers, if you expect to discard the instance.)

```js
myClient.close();

if (allDone) {
  // detach all subscribers
  myClient.off();
}
```

### Choosing a Bridge

SubEtha provides three bridges urls: "local" (the default), "public", and "tracked". All are located in the `Subetha.bridges` namespace, and are simple urls. If your client's network name references a key in this namespace, the aliased values will be used. Bridge aliases are not required, but can make your code more readable and possibly improve portability.

Adding your own bridge (alias) is easy. Just add a string property to the `Subetha.bridges` namespace. Note that SubEtha will prefix strings that look like urls with a missing scheme (like, no "http://").


```js
// alias the "some.com" network with a bridge url
Subetha.bridges.analytics = 'some.com/subetha/bridge.html';

// open a client using this alias
var activityClient = new Subetha.Client().open('events@analytics');
// equivalent to 'events@some.com/subetha/bridge.html'

// urls get sanitized after #open()
console.log(activityClient.network); // -> "//some.com/subetha/bridge.html"
```

The _public_ alias points to a third-party url that also loads a bridge. The _tracked_ alias points to the same network as _public_, but loads a bridge that will anonymously track traffic metrics. Using this bridge greatly assist others in understanding how and where SubEtha is in use.

Finally, the _local_ alias is a JavaScript URL, which renders a dynamic bridge page that loads its bridge from a public server. Feel free to edit this alias and target your own/local bridge file.


## SubEtha Bridge

A SubEtha bridge must be hosted on a page that does not load the client library. Bridges bootstrap themeselves, have no UI, and are configured to accept all clients and relay all messages.

### Handling Requests

To manually intercept client authentications and message relays, subscribe to their respective "auth" and "relay" events. Both events provide a _request object_, which you may handle asynchronously.

```js
SBridge
  // intercept client authentication
  .on('auth', function (req) {
    // perform logic now and/or handle this request later
  })
  // intercept message relay
  .on('relay', function (req) {
    // perform logic now and/or handle this request later
  });
```

To restore automatic client authentications and message relays, detach all corresponding subscription(s).

```js
// detaches all "auth" and "relay" subscribers
SBridge.off('auth').off('relay');
```

To "handle" a request invoke it's `allow()`, `deny()`, or `ignore()` method. Calling any of these methods executes some decision logic and returns `true`. Once a request is handled, these methods do nothing and return `false`.

```js
SBridge.on('auth', function (req) {
  if (req.client.origin != 'http://example.com') {
    // the first method called, wins
    req.deny();
  }
  // does nothing if already denied
  req.allow();
});
```

#### Client Authentication

Authentication-requests are captured in the `SBridge.pendingAuths` array, and may be handled in any order. Requests are ignored (and removed) when the awaiting client closes it's connection.

You may inspect (and use) client credentials via the `.credentials` array. An empty array means the client did not send credentials. (Clients may set credentials via the `.creds()` or `.open()` methods.)

```js
SBridge.on('auth', function (req) {
  if (req.credentials.length) {
    // verify credentials
  } else {
    req.deny();
  }
});
```

#### Message Relay

Relay-requests must be handled in the order they were received. The current, unhandled request is at `SBridge.pendingRelay`.

```js
SBridge.on('relay', function (req) {
  if (!req.msg.to) {
    req.deny('broadcasts are prohibited');
  }
  req.allow();
});
```


## Installation

All SubEtha modules are intended for modern web browsers, and support [CommonJS](http://wiki.commonjs.org/wiki/CommonJS) ([Node](http://nodejs.org/)) or [AMD](http://wiki.commonjs.org/wiki/Modules/AsynchronousDefinition) ([RequireJS](http://requirejs.org/)) environments.

If a SubEtha module is not compatible with your favorite runtime, please file an issue or pull-request (preferred).

### Dependencies

SubEtha depends on the [Morus](https://github.com/bemson/morus) library, to encode and decode messages sent via postMessage.

Both modules use the following ECMAScript 5 and HTML 5 features:

  * [JSON.parse](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse)
  * [JSON.stringify](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
  * [localStorage](http://diveintohtml5.info/storage.html)
  * [postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window.postMessage)


## Considerations

SubEtha is in alpha development. Testing and pull-requests are encouraged. Production deploys are discouraged and at your own risk.

As well, please take note of the following:

  * **Features** will be incomplete, broken, and/or untested. You should also expect backwards API breakages.
  * **Security** is as security does: Do not share what you do not want shared. While SubEtha leverages the origin-based security of localStorage, it supplements the same in postMessage.
  * **Message** size limits are currently unchecked. Multi-part messages are on the roadmap, but not in the works.
  * **Encoding and decode** of messages is synchronous. An asynchronous, swappable security scheme is on the roadmap.
  * **This repository will be split up.** None of the modules have proper json manifests - everything is disorganized.

