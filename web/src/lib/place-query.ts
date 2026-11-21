// When the place picker's suggestions (components/place-picker.tsx) are the answer to what is in its field.

/** Shorter than this, OpenStreetMap isn't asked. */
export const MIN_QUERY = 2;

/** Whether the list on screen is for `name`, the field's words: the debounce has asked for exactly them, and what the query holds
 *  is its own answer, not the previous query's kept on screen (`placeholderData`) while the new one is fetched. Words too short to
 *  ask for have nothing to wait for. */
export const answered = (name: string, asked: string, query: { isFetching: boolean; isPlaceholderData: boolean }): boolean =>
  name === asked && (asked.length < MIN_QUERY || !(query.isFetching || query.isPlaceholderData));
