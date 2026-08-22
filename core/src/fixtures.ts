/**
 * Project construction.
 *
 * There is deliberately no sample project. A fixture with no real pixels cannot
 * demonstrate sequencing — the whole question the light table answers is how
 * photographs look next to each other — so first run starts empty and the user
 * imports their own.
 */

import type { PageSize, Project } from './types'

export const A5_PORTRAIT: PageSize = { name: 'A5 portrait', width: 148, height: 210 }
export const SQUARE_200: PageSize = { name: '200mm square', width: 200, height: 200 }

export function createEmptyProject(name = 'Untitled book'): Project {
  return {
    name,
    pageSize: A5_PORTRAIT,
    assets: [],
    canvas: { placements: [] },
    frames: [],
    pages: [],
    typeBaseSize: 10,
    typeRatio: 1.5,
  }
}
