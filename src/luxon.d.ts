import 'luxon';

// @types/luxon only declares singular unit names on DateObjectUnits, but the
// luxon runtime also accepts plural names. Extend the interface so calls like
// `.set({ hours, minutes })` type-check without changing the code.
declare module 'luxon' {
  interface DateObjectUnits {
    days?: number | undefined;
    hours?: number | undefined;
    minutes?: number | undefined;
    seconds?: number | undefined;
    milliseconds?: number | undefined;
  }
}
