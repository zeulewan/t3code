import * as NodeTimers from "node:timers";

type NodeSocketModule = typeof import("@effect/platform-node-shared/NodeSocket");
type NodeWebSocketModule = NodeSocketModule["NodeWS"];
type NodeWebSocket = InstanceType<NodeWebSocketModule["WebSocket"]>;
type NodeWebSocketServer = InstanceType<NodeWebSocketModule["WebSocketServer"]>;
type HandleUpgrade = NodeWebSocketServer["handleUpgrade"];

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_PATCH = Symbol.for("@t3tools/server/node-websocket-heartbeat/patch");
const HEARTBEAT_STATE = Symbol.for("@t3tools/server/node-websocket-heartbeat/state");

interface HeartbeatState {
  alive: boolean;
  readonly timer: ReturnType<typeof NodeTimers.setInterval>;
}

type HeartbeatWebSocket = NodeWebSocket & {
  [HEARTBEAT_STATE]?: HeartbeatState | undefined;
};

type PatchableWebSocketServerPrototype = NodeWebSocketServer & {
  [HEARTBEAT_PATCH]?: true | undefined;
  handleUpgrade: HandleUpgrade;
};

function installHeartbeat(wsModule: NodeWebSocketModule, socket: NodeWebSocket) {
  const ws = socket as HeartbeatWebSocket;
  if (ws[HEARTBEAT_STATE] !== undefined) {
    return;
  }

  const state: HeartbeatState = {
    alive: true,
    timer: NodeTimers.setInterval(() => {
      if (ws.readyState !== wsModule.WebSocket.OPEN) {
        cleanup();
        return;
      }
      if (!state.alive) {
        cleanup();
        ws.terminate();
        return;
      }
      state.alive = false;
      try {
        ws.ping();
      } catch {
        cleanup();
        ws.terminate();
      }
    }, HEARTBEAT_INTERVAL_MS),
  };
  state.timer.unref();
  ws[HEARTBEAT_STATE] = state;

  const markAlive = () => {
    state.alive = true;
  };
  function cleanup() {
    NodeTimers.clearInterval(state.timer);
    delete ws[HEARTBEAT_STATE];
    ws.off("pong", markAlive);
    ws.off("close", cleanup);
    ws.off("error", cleanup);
  }

  ws.on("pong", markAlive);
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

export function installNodeWebSocketHeartbeat(wsModule: NodeWebSocketModule) {
  const prototype = wsModule.WebSocketServer.prototype as PatchableWebSocketServerPrototype;
  if (prototype[HEARTBEAT_PATCH] === true) {
    return;
  }

  const originalHandleUpgrade = prototype.handleUpgrade;
  prototype.handleUpgrade = function patchedHandleUpgrade(
    this: NodeWebSocketServer,
    request,
    socket,
    head,
    callback,
  ) {
    return originalHandleUpgrade.call(this, request, socket, head, (ws, upgradedRequest) => {
      installHeartbeat(wsModule, ws);
      callback(ws, upgradedRequest);
    });
  };
  prototype[HEARTBEAT_PATCH] = true;
}
