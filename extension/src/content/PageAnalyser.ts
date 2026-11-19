/*!
 * Copyright Mark McGuill. From strongbox-password-safe/browser-autofill 1.2.3,
 * src/Content/PageAnalyser.ts, licensed under the GNU AGPL v3.
 *
 * Changed for Strongbox MCP AutoFill:
 * - Looks only at its own frame. Upstream also read same-origin child iframes;
 *   here every frame runs its own copy, so the fill can be tied to one origin.
 * - Adds one-time-code fields (see otp.ts). They are excluded from the
 *   username and password fields.
 * - Removed unused helpers (isInputVisible, isInputInViewport) and the
 *   commented-out code.
 */

import { looksLikeOtp } from './otp.ts';

export interface InputVisibilityResult {
  input: HTMLInputElement;
  isVisible: boolean;
}

export class PageAnalyser {
  static async getAllUsernameInputs(): Promise<HTMLInputElement[]> {
    const all = await this.getAllInputs();

    return all.filter(input => PageAnalyser.isUsernameInput(input));
  }

  static async getAllPasswordInputs(): Promise<HTMLInputElement[]> {
    const all = await this.getAllInputs();

    return all.filter(input => PageAnalyser.isPasswordInput(input));
  }

  static async getAllOtpInputs(): Promise<HTMLInputElement[]> {
    const all = await this.getAllInputs();

    return all.filter(input => PageAnalyser.isOtpInput(input));
  }

  static async getAllInputs(): Promise<HTMLInputElement[]> {
    let inputs = Array.from<HTMLInputElement>(document.getElementsByTagName('input'));

    const minInputWidth = 50;
    inputs = inputs.filter(input => input.offsetWidth > minInputWidth);

    const inputPromises = inputs.map(async input => {
      const result: InputVisibilityResult = { input, isVisible: false };

      if (await this.checkInputIsInViewPortUsingIntersectionObserver(input)) {
        result.isVisible = true;
        return result;
      }

      return result;
    });

    const promisesResults = await Promise.allSettled(inputPromises);

    const inputMatches = promisesResults
      .filter(result => result.status === 'fulfilled' && result.value.isVisible)
      .map(result => (result as PromiseFulfilledResult<InputVisibilityResult>).value.input);

    return inputMatches;
  }

  static isOtpInput(input: HTMLInputElement) {
    return looksLikeOtp({ type: input.type, autocomplete: input.autocomplete, name: input.name, id: input.id });
  }

  static isPasswordInput(input: HTMLInputElement) {
    return input.type === 'password' && !PageAnalyser.isOtpInput(input);
  }

  static isUsernameInput(input: HTMLInputElement) {
    const isInteresting = input.type === 'email' || input.type === 'text' || input.type === 'username' || input.type === 'tel';

    if (!isInteresting || PageAnalyser.isOtpInput(input)) {
      return false;
    }

    const usernameLikeFieldMatches = [
      'user',
      'email',
      'e-mail',
      'customer',
      'login',
      'acct',
      'account',
      'clientnumber',
      'benutzer',
      'alias',
      'epost',
    ];

    return PageAnalyser.inputFieldMatchesStrings(input, usernameLikeFieldMatches) && !PageAnalyser.isSearchInput(input);
  }

  static isSearchInput(input: HTMLInputElement) {
    if (input.type === 'search') {
      return true;
    }

    const searchMatchNames: string[] = ['search'];

    return PageAnalyser.inputFieldMatchesStrings(input, searchMatchNames);
  }

  static inputFieldMatchesStrings(input: HTMLInputElement, matchNames: string[]) {
    if (PageAnalyser.stringFuzzyContainsAny(input.id, matchNames)) {
      return true;
    }

    if (PageAnalyser.stringFuzzyContainsAny(input.name, matchNames)) {
      return true;
    }

    if (PageAnalyser.stringFuzzyContainsAny(input.autocomplete, matchNames)) {
      return true;
    }

    if (PageAnalyser.stringFuzzyContainsAny(input.placeholder, matchNames)) {
      return true;
    }

    if (PageAnalyser.stringFuzzyContainsAny(input.title, matchNames)) {
      return true;
    }

    if (input.ariaLabel && PageAnalyser.stringFuzzyContainsAny(input.ariaLabel, matchNames)) {
      return true;
    }

    const allLabels = this.getLabelsForInput(input);

    const labelMatch = allLabels.some(label => PageAnalyser.stringFuzzyContainsAny(label, matchNames));

    if (labelMatch) {
      return true;
    }

    for (let i = 0, atts = input.attributes, n = atts.length; i < n; i++) {
      const att = atts[i];

      if (att.nodeName.toLowerCase() == 'style') {
        continue;
      }

      if (att.nodeValue && PageAnalyser.stringFuzzyContainsAny(att.nodeValue, matchNames)) {
        return true;
      }
    }

    return false;
  }

  static getLabelsForInput(input: HTMLInputElement): string[] {
    const nativeLabels = Array.from(input.labels ?? []);

    const allLabels: string[] = nativeLabels.map(label => label.innerText);

    const prevElement = input.previousElementSibling;
    const nextElement = input.nextElementSibling;

    if (prevElement?.tagName === 'LABEL') {
      const label = prevElement as HTMLLabelElement;
      allLabels.push(label.innerText);
    }

    if (nextElement?.tagName === 'LABEL') {
      const label = nextElement as HTMLLabelElement;
      allLabels.push(label.innerText);
    }

    return allLabels;
  }

  static stringFuzzyContainsAny(string1: string, matches: string[]): boolean {
    if (string1 === undefined || string1 === null) {
      return false;
    }

    const result = matches.find(match => {
      return PageAnalyser.stringFuzzyContains(string1, match);
    });

    return result != undefined;
  }

  static stringFuzzyContains(string1: string, match: string) {
    const value1 = string1
      .replace(/(?:\r\n|\r|\n)/g, '')
      .trim()
      .toLowerCase();

    return value1.indexOf(match.toLowerCase()) !== -1;
  }

  static async checkInputIsInViewPortUsingIntersectionObserver(targetField: HTMLInputElement) {
    return new Promise((resolve, reject) => {
      if (!targetField) {
        reject('');
      }

      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            resolve(true);
          } else {
            resolve(false);
          }

          observer.disconnect();
        });
      });

      observer.observe(targetField);
    });
  }
}
