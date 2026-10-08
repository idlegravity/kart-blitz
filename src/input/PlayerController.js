/**
 * PlayerController — copies an InputSource's state into kart.input every frame.
 * OWNER: Driving agent. Contract: new PlayerController(game, kart, source = game.input); update(dt); dispose().
 * `controller.source` is the InputSource driving the kart (also used to route rumble to the kart's own pad).
 *
 * Sources report `drift` / `item` as true for the frame of a latched tap (down+up between two frames),
 * so even a very quick hop tap or item tap arrives here as a one-frame press and is seen by the kart's /
 * ItemSystem's edge detection.
 */
export class PlayerController {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('../kart/Kart.js').Kart} kart
   * @param {import('./InputSource.js').InputSource} [source] defaults to the merged game.input ('any')
   */
  constructor(game, kart, source = null) {
    this.game = game;
    this.kart = kart;
    this.source = source ?? game.input;
  }

  update() {
    const i = this.source;
    const k = this.kart.input;
    k.throttle = i.throttle;
    k.brake = i.brake;
    k.steer = i.steer;
    k.analog = i.steerAnalog === true;
    k.assist = i.steerAssist === true ? 1 : 0; // mobile touch steering assist (Kart._updateYaw), 0 on desktop
    k.drift = i.drift || i.pressed('drift');
    k.item = i.item || i.pressed('item');
    k.lookBack = i.lookBack;
    k.aimBack = i.aimBack;
  }

  dispose() {}
}
