import { NextResponse } from 'next/server'
import { seed } from '@/lib/seed'

export async function POST() {
  try {
    await seed()
    return NextResponse.json({
      success: true,
      message: 'Base de datos poblada con datos reales (16 películas, 6 series, 44 episodios)',
    })
  } catch (error) {
    console.error('Seed error:', error)
    return NextResponse.json(
      { error: 'Error al poblar la base de datos', details: String(error) },
      { status: 500 }
    )
  }
}