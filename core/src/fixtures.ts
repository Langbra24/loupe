/**
 * A sample project, so the shell renders real book structure instead of empty
 * states. Development scaffolding — this goes away once projects can be
 * created and persisted for real.
 */

import type { PageSize, Page, Project } from './types'

export const A5_PORTRAIT: PageSize = { name: 'A5 portrait', width: 148, height: 210 }
export const SQUARE_200: PageSize = { name: '200mm square', width: 200, height: 200 }

/** Plate captions, so the layers panel and filmstrip read like an actual
 *  photobook rather than "Page 1, Page 2, Page 3". */
const PLATES = [
  'Cover — Harbour wall, dawn',
  'Half title',
  'Untitled (fog line)',
  'Breakwater, low tide',
  'The ferry, waiting',
  'Gulls over the slipway',
  'Untitled (fog line, later)',
  'Net loft interior',
  'Portrait — Marja',
  'Hull, repainted',
  'The channel at dusk',
  'Colophon',
]

export function createSampleProject(): Project {
  const pages: Page[] = PLATES.map((plate, index) => buildPage(index, plate))

  return {
    name: 'Harbour — dummy 03',
    pageSize: A5_PORTRAIT,
    pages,
    typeBaseSize: 10,
    typeRatio: 1.5,
  }
}

function buildPage(index: number, plate: string): Page {
  const id = `page-${index + 1}`
  const isTextPage = plate === 'Half title' || plate === 'Colophon'

  if (isTextPage) {
    return {
      id,
      elements: [
        {
          id: `${id}-title`,
          kind: 'text',
          name: plate,
          content: plate === 'Half title' ? 'Harbour' : 'Printed in an edition of 50.',
          role: plate === 'Half title' ? 'title' : 'credit',
          align: 'left',
          frame: { x: 0.11, y: 0.11, width: 0.66, height: 0.12 },
          locked: false,
          hidden: false,
        },
      ],
    }
  }

  return {
    id,
    elements: [
      {
        id: `${id}-image`,
        kind: 'image',
        name: plate,
        assetId: `asset-${index + 1}`,
        fit: 'cover',
        frame: { x: 0.11, y: 0.11, width: 0.78, height: 0.62 },
        locked: false,
        hidden: false,
      },
      {
        id: `${id}-caption`,
        kind: 'text',
        name: 'Caption',
        content: plate,
        role: 'caption',
        align: 'left',
        frame: { x: 0.11, y: 0.76, width: 0.62, height: 0.06 },
        locked: false,
        hidden: false,
      },
    ],
  }
}
