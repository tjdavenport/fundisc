const axios = require('axios');
const WebSocket = require('ws');
const {URLSearchParams} = require('url');

const gateway = async (api = 'https://discord.com/api') => {
  const {data: {url}} = await axios.get(`${api}/gateway`);
  return `${url}?${new URLSearchParams({v: 8, encoding: 'json'})}`;
};

class Res extends Map {
  constructor(sendable) {
    super();
    this.sendable = sendable;
  }

  static ended = Symbol('ended');

  send = payload => this.sendable.send(JSON.stringify(payload));
  end = () => Res.ended;
}

class Req extends Map {
  constructor(payload) {
    super();
    this.payload = JSON.parse(payload);
  }
}

class Fundisc extends Map {
  constructor(...args) {
    super(...args);
    this.stack = [];
    this.sink = undefined;
  }
  use = (...middlewares) => {
    this.stack.push(middlewares);
    return this;
  };
  catch = (...middlewares) => {
    !this.sink && (this.sink = []);
    this.sink.push(middlewares);
    return this;
  };
  connect = async (reqres, middlewares, error) => {
    for (const middleware of middlewares) {
      if (await new Promise((resolve, reject) => {
        const args = [...reqres, thrown => thrown ? reject(thrown) : resolve()];

        error && args.unshift(error);

        return Promise.resolve(middleware(...args))
          .then(out => resolve(out)).catch(error => reject(error)) || resolve()
      }) === Res.ended) {
        return Res.ended;
      }
    }
  };
  handle = async (payload, sendable) => {
    const reqres = [new Req(payload), new Res(sendable)];

    try {
      for (const middlewares of this.stack) {
        if (await this.connect(reqres, middlewares) === Res.ended) return;
      }
    } catch (error) {
      for (const middlewares of (this.sink || [[() => console.error(error)]])) {
        if (await this.connect(reqres, middlewares, error) === Res.ended) return;
      }
    }
  };
  listen = async (...args) => {
    const sendable = args[0] ? await args[0]() : await gateway()
      .then(url => new WebSocket(url));
    const handle = payload => this.handle(payload, sendable);

    sendable.on('message', handle);
    sendable.on('ready', handle);
    sendable.on('close', this.listen(...args).catch(error => console.error(error)));

    return sendable;
  };
}

const seq = handle => req => handle(req.payload.op === 1 ? req.payload.d : req.payload.seq);

const heartbeat = getSeq => {
  const cache = {acked: true, interval: undefined};

  return (req, res, next) => {
    if (req.payload.op === 11) {
      cache.acked = true;
      return next();
    }

    if (req.payload.op === 10 && !cache.interval) {
      console.log('setting interval');
      cache.interval = setInterval(async () => {
        try {
          if (cache.acked) {
            const d = await getSeq();
            res.send({op: 1, d: await getSeq()});
            cache.acked = false;
          } else {
            throw new Error('ACK not received. Connection considered dead');
          }
        } catch (error) {
          res.sendable.close(1011);
          clearInterval(cache.interval);
          cache.interval = undefined;
          cache.acked = true;
          console.error('could not send heartbeat');
          console.error(error);
        }
      }, req.payload.d.heartbeat_interval);
    }

    return next();
  }; 
}

exports.gateway = gateway;
exports.fundisc = () => new Fundisc();
exports.seq = seq;
exports.heartbeat = heartbeat;
