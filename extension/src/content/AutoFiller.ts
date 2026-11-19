/*!
 * Copyright Mark McGuill. From strongbox-password-safe/browser-autofill 1.2.3,
 * src/Content/AutoFiller.ts, licensed under the GNU AGPL v3.
 *
 * Changed for Strongbox MCP AutoFill:
 * - Takes plain values (username, password, optional one-time code) instead of
 *   an AutoFillCredential; a missing value leaves its field alone.
 * - Fills the first one-time-code field.
 * - Fills only the first field of each kind. Removed the inline-menu initiator,
 *   fillMultiple, doItSingleField, append mode and the highlight animation
 *   (it needed upstream's injected CSS).
 */

import { PageAnalyser } from './PageAnalyser.ts';

export interface FillValues {
  username?: string;
  password?: string;
  totp?: string;
}

export class AutoFiller {
  async doIt(values: FillValues): Promise<boolean> {
    const usernames = values.username === undefined ? [] : await PageAnalyser.getAllUsernameInputs();
    const passwords = values.password === undefined ? [] : await PageAnalyser.getAllPasswordInputs();
    const otps = values.totp === undefined ? [] : await PageAnalyser.getAllOtpInputs();

    let filledSomething = false;

    if (usernames.length > 0) {
      this.fillField(usernames[0], values.username!);
      filledSomething = true;
    }

    if (passwords.length > 0) {
      this.fillField(passwords[0], values.password!);
      filledSomething = true;
    }

    if (otps.length > 0) {
      this.fillField(otps[0], values.totp!);
      filledSomething = true;
    }

    return filledSomething;
  }

  private getKeyboardEvent(eventName: string) {
    return new window.KeyboardEvent(eventName, {
      bubbles: true,
      cancelable: false,
    });
  }

  private fillField(field: HTMLInputElement, value: string) {
    const originalValue = field.value;

    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    });

    clickEvent.stopPropagation();

    field.dispatchEvent(clickEvent);
    field.focus();

    field.dispatchEvent(this.getKeyboardEvent('keydown'));
    field.dispatchEvent(this.getKeyboardEvent('keypress'));
    field.dispatchEvent(this.getKeyboardEvent('keyup'));

    if (field.value !== originalValue) {
      field.value = originalValue;
    }

    field.value = value;

    field.dispatchEvent(this.getKeyboardEvent('keydown'));
    field.dispatchEvent(this.getKeyboardEvent('keypress'));
    field.dispatchEvent(this.getKeyboardEvent('keyup'));

    const onInputEvent = field.ownerDocument.createEvent('HTMLEvents');
    onInputEvent.initEvent('input', true, true);
    field.dispatchEvent(onInputEvent);

    const onChangeEvent = field.ownerDocument.createEvent('HTMLEvents');
    onChangeEvent.initEvent('change', true, true);
    field.dispatchEvent(onChangeEvent);

    field.blur();

    if (field.value !== value) {
      field.value = value;
    }
  }
}
