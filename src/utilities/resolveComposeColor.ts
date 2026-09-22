import { ColorRgba } from '@typings/valueTypes'

/**
 * Figma's "Control opacity at scale" feature (2026) stores a translucent colour as
 * a COMPOSE_COLOR expression: a reference to a base colour variable plus an alpha
 * percentage. The plugin's normal value handling only knows VARIABLE_ALIAS and raw
 * RGBA, so without this the expression falls through to `roundRgba` and the alpha is
 * lost (the colour renders fully opaque).
 *
 * This resolves the expression to a concrete RGBA: it follows the base reference to
 * its RGB for the given mode (matching modes by name across collections, since mode
 * ids differ per collection) and applies the alpha argument.
 */

// Figma variable expression value shape (not yet in the plugin typings)
type ComposeColorValue = {
  type: 'VARIABLE_EXPRESSION'
  expressionFunction: 'COMPOSE_COLOR'
  expressionArguments: [VariableAlias | RawRgba, number | VariableAlias]
}
type VariableAlias = { type: 'VARIABLE_ALIAS'; id: string }
type RawRgba = { r: number; g: number; b: number; a?: number }

const isAlias = (v: unknown): v is VariableAlias =>
  !!v && typeof v === 'object' && (v as { type?: string }).type === 'VARIABLE_ALIAS'

const isComposeColor = (v: unknown): v is ComposeColorValue =>
  !!v &&
  typeof v === 'object' &&
  (v as { type?: string }).type === 'VARIABLE_EXPRESSION' &&
  (v as { expressionFunction?: string }).expressionFunction === 'COMPOSE_COLOR'

export { isComposeColor }

// Pick the mode of a variable's own collection that matches the wanted mode by name.
// A single-mode collection (e.g. Primitives) applies to every theme, so fall back to
// its only/default mode.
const pickModeId = (collection: VariableCollection, modeName?: string): string => {
  const byName = collection.modes.find((m) => m.name === modeName)
  if (byName) return byName.modeId
  const byDefault = collection.modes.find((m) => m.modeId === collection.defaultModeId)
  return (byDefault ?? collection.modes[0]).modeId
}

const resolveVariableToRgba = async (
  variable: Variable,
  modeName?: string
): Promise<RawRgba> => {
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    variable.variableCollectionId
  )
  const value = variable.valuesByMode[pickModeId(collection, modeName)]
  return resolveValueToRgba(value, modeName)
}

const resolveValueToRgba = async (
  value: unknown,
  modeName?: string
): Promise<RawRgba> => {
  if (isAlias(value)) {
    const base = await figma.variables.getVariableByIdAsync(value.id)
    if (!base) throw new Error(`Cannot resolve variable alias ${value.id}`)
    return resolveVariableToRgba(base, modeName)
  }
  if (isComposeColor(value)) {
    return resolveComposeColor(value, modeName)
  }
  // raw RGBA
  return value as RawRgba
}

const resolveAlpha = async (
  alphaArg: number | VariableAlias,
  modeName?: string
): Promise<number> => {
  let raw: number
  if (isAlias(alphaArg)) {
    const alphaVar = await figma.variables.getVariableByIdAsync(alphaArg.id)
    const collection = await figma.variables.getVariableCollectionByIdAsync(
      alphaVar.variableCollectionId
    )
    raw = alphaVar.valuesByMode[pickModeId(collection, modeName)] as number
  } else {
    raw = alphaArg
  }
  // The compose alpha argument is a percentage (0-100). A bound FLOAT variable may
  // already be a 0-1 fraction, so only divide values that are clearly percentages.
  return raw > 1 ? raw / 100 : raw
}

const resolveComposeColor = async (
  value: ComposeColorValue,
  modeName?: string
): Promise<ColorRgba> => {
  const [baseArg, alphaArg] = value.expressionArguments
  const base = isAlias(baseArg)
    ? await resolveValueToRgba(baseArg, modeName)
    : (baseArg as RawRgba)
  const a = await resolveAlpha(alphaArg, modeName)
  return { r: base.r, g: base.g, b: base.b, a }
}

export default resolveComposeColor
