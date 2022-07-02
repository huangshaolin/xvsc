import { TextEditor, workspace } from 'vscode';
import { documentRippleScanner } from './documentRippleScanner';
import { tokenizer } from './tokenizer';
import { fuzzySearch } from './fuzzySearch';

export class SimpleAutocomplete {
  private state: {
    needle: string;
    nextIterator: IterableIterator<string> | undefined;
    preventReset: boolean;
    foundMatches: string[];
    currentIdx: number;
    isActive: boolean;
    nextDone: boolean;
  };

  constructor() {
    this.next = this.next.bind(this);
    this.prev = this.prev.bind(this);
    this.reset = this.reset.bind(this);

    this.reset();
  }

  public reset() {
    if (!this.state || (this.state.preventReset !== true && this.state.isActive)) {
      this.state = {
        needle: '',
        nextIterator: undefined,
        preventReset: false,
        foundMatches: [],
        currentIdx: -1,
        isActive: false,
        nextDone: false,
      };
    }
  }

  public next(activeTextEditor: TextEditor) {
    this.state.isActive = true;

    if (this.canAutocomplete(activeTextEditor)) {
      const idx = this.getNextMatchIdx(activeTextEditor);
      const token = this.state.foundMatches[idx];
      if (token) {
        this.setMatch(token, activeTextEditor);
      }
    } else {
      this.reset();
    }
  }
  public prev(activeTextEditor: TextEditor) {
    if (this.state.isActive && this.state.foundMatches.length) {
      let idx = 0;
      if (this.state.currentIdx > 0) {
        idx = this.state.currentIdx - 1;
      } else {
        idx = this.state.foundMatches.length - 1;
      }
      this.state.currentIdx = idx;
      const token = this.state.foundMatches[this.state.currentIdx];
      this.setMatch(token, activeTextEditor);
      return;
    }

    this.reset();
  }

  private canAutocomplete(activeTextEditor: TextEditor) {
    const { selection, document } = activeTextEditor;
    const wordRange = document.getWordRangeAtPosition(selection.end);

    if (
      wordRange === undefined ||
      wordRange.end.character !== selection.end.character ||
      selection.start.line !== selection.end.line ||
      selection.start.character !== selection.end.character
    ) {
      return false;
    } else {
      return true;
    }
  }

  private getNextMatchIdx(activeTextEditor: TextEditor): number {
    if (this.state.currentIdx < this.state.foundMatches.length - 1) {
      return this.state.currentIdx + 1;
    }

    if (this.state.nextDone) {
      return 0;
    }

    if (!this.state.nextIterator) {
      this.state.nextIterator = this.nextGenerator(activeTextEditor);
    }

    const nextResult = this.state.nextIterator.next();
    if (nextResult.done) {
      this.state.nextDone = true;
      return 0;
    } else {
      const token = nextResult.value;
      this.state.foundMatches.push(token);
      return this.state.foundMatches.length - 1;
    }
  }

  private *nextGenerator(activeTextEditor: TextEditor) {
    this.setNeedle(activeTextEditor);

    if (!this.state.needle) {
      return;
    }

    const { document, selection } = activeTextEditor;
    const documentIterator = documentRippleScanner(document, selection.end.line);
    for (const line of documentIterator) {
      const wordSeparators = workspace.getConfiguration().editor.wordSeparators;
      const tokensIterator = tokenizer(line.text, wordSeparators);

      for (const token of tokensIterator) {
        if (
          fuzzySearch(this.state.needle.toLowerCase(), token.toLowerCase()) &&
          this.state.foundMatches.indexOf(token) === -1
        ) {
          yield token;
        }
      }
    }
  }

  private setNeedle(activeTextEditor: TextEditor) {
    const { document, selection } = activeTextEditor;
    const needle = document.getText(document.getWordRangeAtPosition(selection.end));

    if (typeof needle === 'string') {
      this.state.foundMatches.push(needle);
      this.state.currentIdx += 1;
      this.state.needle = needle;
    }
  }

  private async setMatch(match: string, activeTextEditor: TextEditor) {
    const { selections, document } = activeTextEditor;

    // Start from last selection so that edits don't alter the locations of previous selections
    for (let i = selections.length - 1; i >= 0; i--) {
      const selection = selections[i];
      const wordRange = document.getWordRangeAtPosition(selection.end);

      if (wordRange) {
        this.state.preventReset = true;

        await activeTextEditor.edit(editBuilder => {
          editBuilder.delete(wordRange);
          editBuilder.insert(selection.end, match);
        });

        this.state.preventReset = false;
      }
    }
  }
}
