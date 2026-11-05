import { describe, expect, it } from 'vitest';
import type { InputAction } from '../src/app/contracts';
import { createInputCore } from '../src/input/core';

function setup() {
  const core = createInputCore();
  const seen: InputAction[] = [];
  core.onAction((a) => seen.push(a));
  const press = (code: string, extra: object = {}) => core.keyDown({ code, ...extra });
  const release = (code: string) => core.keyUp({ code });
  return { core, seen, press, release };
}

describe('input core', () => {
  it('steers with WASD and arrows in flight mode (W nose down, S nose up)', () => {
    const { core, press, release } = setup();
    press('KeyD');
    expect(core.controls().turn).toBe(1);
    press('KeyA');
    expect(core.controls().turn).toBe(0);
    release('KeyD');
    release('KeyA');
    press('ArrowLeft');
    expect(core.controls().turn).toBe(-1);
    release('ArrowLeft');
    press('KeyW');
    expect(core.controls().pitch).toBe(-1);
    release('KeyW');
    press('ArrowDown');
    expect(core.controls().pitch).toBe(1);
    expect(core.hasFlightInput()).toBe(true);
    release('ArrowDown');
    expect(core.hasFlightInput()).toBe(false);
  });

  it('Shift boosts and counts as flight input', () => {
    const { core, press, release } = setup();
    press('ShiftLeft');
    expect(core.controls().boost).toBe(true);
    expect(core.hasFlightInput()).toBe(true);
    release('ShiftLeft');
    expect(core.controls().boost).toBe(false);
  });

  it('emits actions in flight mode and prevents default for Tab', () => {
    const { core, seen, press } = setup();
    expect(press('Tab')).toBe(true);
    press('KeyM');
    press('Space');
    press('Escape');
    press('Enter');
    press('KeyE');
    press('KeyH');
    for (let i = 1; i <= 9; i++) press(`Digit${i}`);
    expect(seen.slice(0, 7)).toEqual(['nav', 'nav', 'briefing', 'back', 'engage', 'interact', 'help']);
    expect(seen.slice(7)).toEqual(['select1', 'select2', 'select3', 'select4', 'select5', 'select6', 'select7', 'select8', 'select9']);
    expect(core.mode).toBe('flight');
  });

  it('does not repeat actions while a key is held', () => {
    const { seen, press } = setup();
    press('Enter');
    press('Enter', { repeat: true });
    press('Enter', { repeat: true });
    expect(seen).toEqual(['engage']);
  });

  it('dialog mode: arrows and A/D page, no steering, Esc/Tab/Enter/digits still emit', () => {
    const { core, seen, press } = setup();
    core.setMode('dialog');
    press('ArrowLeft');
    press('KeyA');
    press('ArrowRight');
    press('KeyD');
    expect(seen).toEqual(['prev', 'prev', 'next', 'next']);
    expect(core.controls()).toEqual({ turn: 0, pitch: 0, boost: false });
    expect(core.hasFlightInput()).toBe(false);
    press('Escape');
    press('Tab');
    press('Enter');
    press('Digit2');
    expect(seen.slice(4)).toEqual(['back', 'nav', 'engage', 'select2']);
    press('KeyW');
    press('Space');
    expect(seen.length).toBe(8);
    press('KeyE');
    expect(seen.slice(8)).toEqual(['interact']);
  });

  it('chat mode: only Esc emits, even from a text field; everything else reaches the page', () => {
    const { core, seen, press } = setup();
    core.setMode('chat');
    expect(press('Tab')).toBe(false);
    expect(press('Enter')).toBe(false);
    expect(press('Space')).toBe(false);
    expect(press('Digit1')).toBe(false);
    expect(press('KeyD', { editable: true })).toBe(false);
    expect(seen).toEqual([]);
    expect(press('Escape', { editable: true, composing: true })).toBe(false);
    expect(press('Escape', { editable: true })).toBe(true);
    press('Escape', { repeat: true });
    expect(seen).toEqual(['back']);
    expect(core.controls()).toEqual({ turn: 0, pitch: 0, boost: false });
  });

  it('off mode: nothing', () => {
    const { core, seen, press } = setup();
    core.setMode('off');
    press('Enter');
    press('KeyD');
    expect(seen).toEqual([]);
    expect(core.controls()).toEqual({ turn: 0, pitch: 0, boost: false });
  });

  it('ignores keys typed into inputs and modified shortcuts', () => {
    const { core, seen, press } = setup();
    expect(press('KeyD', { editable: true })).toBe(false);
    press('Enter', { editable: true });
    press('Digit1', { metaKey: true });
    press('KeyW', { ctrlKey: true });
    expect(seen).toEqual([]);
    expect(core.controls().turn).toBe(0);
    expect(core.controls().pitch).toBe(0);
  });

  it('blur releases held keys', () => {
    const { core, press } = setup();
    press('KeyD');
    press('ShiftLeft');
    core.blur();
    expect(core.controls()).toEqual({ turn: 0, pitch: 0, boost: false });
  });

  it('mouse drag steers relative to the press point', () => {
    const { core } = setup();
    core.dragStart(500, 400);
    expect(core.controls().turn).toBe(0);
    core.dragMove(560, 400);
    expect(core.controls().turn).toBeGreaterThan(0.3);
    core.dragMove(900, 400);
    expect(core.controls().turn).toBe(1);
    core.dragMove(500, 300);
    expect(core.controls().pitch).toBeLessThan(-0.5); // drag up = nose down, like the stick
    expect(core.hasFlightInput()).toBe(true);
    core.dragEnd();
    expect(core.controls()).toEqual({ turn: 0, pitch: 0, boost: false });
    expect(core.hasFlightInput()).toBe(false);
  });

  it('touch stick and boost button', () => {
    const { core, seen } = setup();
    core.setStick({ x: 0.05, y: -0.05 });
    expect(core.hasFlightInput()).toBe(false); // inside the dead zone
    core.setStick({ x: 1, y: 1 });
    expect(core.controls().turn).toBe(1);
    expect(core.controls().pitch).toBe(1);
    core.setStick(null);
    core.setTouchBoost(true);
    expect(core.controls().boost).toBe(true);
    core.trigger('nav');
    core.trigger('briefing');
    expect(seen).toEqual(['nav', 'briefing']);
  });

  it('unsubscribe stops delivery', () => {
    const core = createInputCore();
    const seen: InputAction[] = [];
    const off = core.onAction((a) => seen.push(a));
    core.keyDown({ code: 'Enter' });
    off();
    core.keyDown({ code: 'Escape' });
    expect(seen).toEqual(['engage']);
  });
});
