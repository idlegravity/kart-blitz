/**
 * PlayerController — copies the merged keyboard/gamepad state into kart.input every frame.
 * OWNER: Driving agent. Contract: new PlayerController(game, kart); update(dt); dispose().
 *
 * InputManager reports `drift` / `item` as true for the frame of a latched tap (down+up between two frames),
 * so even a very quick hop tap or item tap arrives here as a one-frame press and is seen by the kart's /
 * ItemSystem's edge detection.
 */
export class PlayerController {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('../kart/Kart.js').Kart} kart
   */
  constructor(game, kart) {
    this.game = game;
    this.kart = kart;
  }

  update() {
    const i = this.game.input;
    const k = this.kart.input;
    k.throttle = i.throttle;
    k.brake = i.brake;
    k.steer = i.steer;
    k.analog = i.steerAnalog === true;
    k.drift = i.drift || i.pressed('drift');
    k.item = i.item || i.pressed('item');
    k.lookBack = i.lookBack;
    k.aimBack = i.aimBack;
  }

  dispose() {}
}
