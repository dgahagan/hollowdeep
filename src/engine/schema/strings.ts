import { z } from 'zod';
import { zId } from './common';

/**
 * Named message strings, referenced by id from `printId`/`die.messageId`/
 * `darkness.*MessageId` (design plan §4.1).
 *
 * Why a string table rather than inline text everywhere: death messages,
 * darkness warnings and thief taunts are reused from several call sites, and
 * the narrator's dry voice is easier to keep consistent when the lines sit
 * together in one file. Inline `print` stays available for one-offs.
 */
export const zStrings = z.record(zId, z.string().min(1));
export type Strings = z.infer<typeof zStrings>;
