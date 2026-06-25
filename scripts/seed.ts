import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// ─── Películas reales con pósters públicos ────────────────────────
// Posters y backdrops desde CDN público (sin registro, sin API key)

const movies = [
  {
    title: 'Inception',
    description: 'Cobb, un hábil ladrón que comete espionaje corporal infiltrándose en el subconsciente de sus objetivos, es ofrecido la oportunidad de recuperar su antigua vida como pago por una tarea considerada imposible: "inception", la implantación de una idea en la mente de un objetivo.',
    year: 2010, rating: 8.8, duration: '2h 28m',
    genre: 'Acción, Ciencia Ficción, Thriller', type: 'movie', maturity: 'PG-13', featured: true,
    coverImage: 'https://image.tmdb.org/t/p/w500/xlaY2zyzMfkhk0HSC5VUwzoZPU1.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w780/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg',
  },
  {
    title: 'The Dark Knight',
    description: 'Cuando el amenazador conocido como el Joker emerge de su misterioso y siniestro pasado, causa estragos y caos en la gente de Gotham. Batman debe aceptar una de las mayores pruebas psicológicas y físicas para combatir la injusticia.',
    year: 2008, rating: 8.5, duration: '2h 32m',
    genre: 'Acción, Crimen, Drama, Thriller', type: 'movie', maturity: 'PG-13', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w780/cfT29Im5VDvjE0RpyKOSdCKZal7.jpg',
  },
  {
    title: 'The Godfather',
    description: 'La historia de la familia Corleone, una de las más poderosas dinastías del crimen organizado en América. Don Vito Corleone, el patriarca, transmite los valores de su imperio a su hijo menor Michael, quien inicialmente quiere mantenerse al margen del negocio familiar.',
    year: 1972, rating: 8.7, duration: '2h 55m',
    genre: 'Crimen, Drama', type: 'movie', maturity: 'R', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/3bhkrj58Vtu7enYsRolD1fZdja1.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/3bhkrj58Vtu7enYsRolD1fZdja1.jpg',
  },
  {
    title: 'Fight Club',
    description: 'Un insomne desesperado y un vendedor de jabón deslizante canalizan la agresión masculina primaria hacia una nueva y chocante forma de terapia. Su concepto cobra vida con un club de lucha clandestino que se convierte en algo mucho más grande.',
    year: 1999, rating: 8.4, duration: '2h 19m',
    genre: 'Drama, Thriller', type: 'movie', maturity: 'R', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/jSziioSwPVrOy9Yow3XhWIBDjq1.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/jSziioSwPVrOy9Yow3XhWIBDjq1.jpg',
  },
  {
    title: 'Pulp Fiction',
    description: 'Un asesino a sueldo amante de las hamburguesas, su socio filosófico, la amante de un gángster drogadicto y un boxeador fracasado convergen en esta extravagante y cómica historia criminal. Sus aventuras se desarrollan en tres historias que entrelazan magistralmente.',
    year: 1994, rating: 8.5, duration: '2h 34m',
    genre: 'Crimen, Drama, Thriller', type: 'movie', maturity: 'R', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/vQWk5YBFWF4bZaofAbv0tShwBvQ.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/vQWk5YBFWF4bZaofAbv0tShwBvQ.jpg',
  },
  {
    title: 'Forrest Gump',
    description: 'Un hombre con un coeficiente intelectual bajo ha logrado grandes cosas en su vida y ha estado presente en eventos históricos significativos, superando todo lo que alguien imaginó que podía hacer. Pero a pesar de todo lo que ha logrado, su verdadero amor lo elude.',
    year: 1994, rating: 8.5, duration: '2h 22m',
    genre: 'Drama, Romance', type: 'movie', maturity: 'PG-13', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/Cw4hIUIAmSYfK9QfaUW5igp9La.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/Cw4hIUIAmSYfK9QfaUW5igp9La.jpg',
  },
  {
    title: 'The Matrix',
    description: 'En el siglo XXII, The Matrix cuenta la historia de un hacker informático que se une a un grupo de insurgentes subterráneos que luchan contra los vastos y poderosos ordenadores que ahora gobiernan la Tierra.',
    year: 1999, rating: 8.2, duration: '2h 16m',
    genre: 'Acción, Ciencia Ficción', type: 'movie', maturity: 'R', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/aOIuZAjPaRIE6CMzbazvcHuHXDc.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w780/tlm8UkiQsitc8rSuIAscQDCnP8d.jpg',
  },
  {
    title: 'Interstellar',
    description: 'Las aventuras de un grupo de exploradores que hacen uso de un agujero negro recién descubierto para superar las limitaciones de los viajes espaciales humanos y conquistar las vastas distancias involucradas en un viaje interestelar.',
    year: 2014, rating: 8.7, duration: '2h 49m',
    genre: 'Aventura, Drama, Ciencia Ficción', type: 'movie', maturity: 'PG-13', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/yQvGrMoipbRoddT0ZR8tPoR7NfX.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w780/2ssWTSVklAEc98frZUQhgtGHx7s.jpg',
  },
  {
    title: 'Whiplash',
    description: 'Bajo la dirección de un instructor despiadado, un talentoso joven baterista comienza a perseguir la perfección a cualquier costo, incluso su humanidad.',
    year: 2014, rating: 8.5, duration: '1h 47m',
    genre: 'Drama, Música', type: 'movie', maturity: 'R', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/7fn624j5lj3xTme2SgiLCeuedmO.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/7fn624j5lj3xTme2SgiLCeuedmO.jpg',
  },
  {
    title: 'The Shawshank Redemption',
    description: 'Andy Dufresne, un banquero condenado a cadena perpetua por el asesinato de su esposa y su amante, llega a la prisión de Shawshank donde se hace amigo de Red, un preso veterano. Su resistencia y esperanza lo llevan a través de dos décadas en prisión.',
    year: 1994, rating: 8.7, duration: '2h 22m',
    genre: 'Drama', type: 'movie', maturity: 'R', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg',
  },
  {
    title: 'Avengers: Endgame',
    description: 'Tras los devastadores eventos de Infinity War, el universo está en ruinas. Con la ayuda de los aliados que quedan, los Vengadores se reúnen una vez más para intentar revertir las acciones de Thanos y restaurar el equilibrio del universo.',
    year: 2019, rating: 8.3, duration: '3h 1m',
    genre: 'Acción, Aventura, Ciencia Ficción', type: 'movie', maturity: 'PG-13', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/ulzhLuWrPK07P1YkdWQLZnQh1JL.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w780/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg',
  },
  {
    title: 'Parasite',
    description: 'Toda la familia de Ki-taek está desempleada. Un día, el hijo mayor recomienda a la familia para trabajar como tutor particular de la hija de una familia adinerada. Lo que comienza como una oportunidad de prosperar se convierte en una espiral de eventos inesperados.',
    year: 2019, rating: 8.5, duration: '2h 12m',
    genre: 'Comedia, Drama, Thriller', type: 'movie', maturity: 'R', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
  },
  {
    title: 'Joker',
    description: 'Durante los años 80, un fracasado comediante en vivo es llevado a la locura y se convierte en una vida de crimen y caos en Gotham City mientras se convierte en una infame figura del crimen psicopática.',
    year: 2019, rating: 8.2, duration: '2h 2m',
    genre: 'Crimen, Drama, Thriller', type: 'movie', maturity: 'R', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg',
  },
  {
    title: 'John Wick: Chapter 4',
    description: 'Con el precio sobre su cabeza aumentando sin parar, John Wick descubre un camino para derrotar a La Alta Mesa. Pero antes de poder ganar su libertad, Wick debe enfrentarse a un nuevo enemigo con poderosas alianzas en todo el mundo.',
    year: 2023, rating: 7.8, duration: '2h 49m',
    genre: 'Acción, Crimen, Thriller', type: 'movie', maturity: 'R', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg',
  },
  {
    title: 'Dune',
    description: 'Paul Atreides, un joven brillante y dotado, nacido en un gran destino más allá de su comprensión, debe viajar al planeta más peligroso del universo para asegurar el futuro de su familia y su pueblo. Como fuerzas malévolas explotan el conflicto por el suministro exclusivo del recurso más valioso de la galaxia.',
    year: 2024, rating: 8.1, duration: '2h 46m',
    genre: 'Ciencia Ficción, Aventura, Drama', type: 'movie', maturity: 'PG-13', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/gDzOcq0pfeCeqMBwKIJlSmQpjkZ.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w780/qVgZu5BTx6pu4owCvVOm4zjTfOi.jpg',
  },
  {
    title: "The Pope's Exorcist",
    description: 'Tras descubrir un caso aterrador, el Padre Gabriele Amorth, el exorcista oficial del Vaticano, se embarca en una investigación sobrenatural que lo llevará a descubrir un secreto oscuro que la Iglesia ha ocultado durante siglos.',
    year: 2023, rating: 6.0, duration: '1h 53m',
    genre: 'Terror, Misterio, Thriller', type: 'movie', maturity: 'R', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/jFC4LS5qTAT3PinzdEzINfu1CV9.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/jFC4LS5qTAT3PinzdEzINfu1CV9.jpg',
  },
  {
    title: 'Inside Out 2',
    description: 'Riley, ahora adolescente, enfrenta nuevas emociones mientras navega los desafíos de la adolescencia. Ansiedad, Envidia, Aburrimiento y Vergüenza se unen a las ya conocidas Alegría, Tristeza, Ira, Asco y Miedo.',
    year: 2024, rating: 7.6, duration: '1h 36m',
    genre: 'Animación, Comedia, Familia', type: 'movie', maturity: 'PG', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg',
  },
]

const seriesData = [
  {
    title: 'Breaking Bad',
    description: 'Un profesor de química de secundaria diagnosticado con cáncer de pulmón se asocia con un antiguo alumno para fabricar y vender metanfetamina para asegurar el futuro financiero de su familia antes de morir.',
    year: 2008, rating: 9.5, duration: null,
    genre: 'Crimen, Drama, Thriller', type: 'series', maturity: 'TV-MA', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/3xnWaLQjelJDDF7LT1WBo6f4BRe.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/3xnWaLQjelJDDF7LT1WBo6f4BRe.jpg',
    episodes: [
      { seasonNumber: 1, episodeNumber: 1, title: 'Piloto', description: 'Walter White, profesor de química, descubre que tiene cáncer. Para asegurar el futuro de su familia, decide fabricar metanfetamina con la ayuda de su ex alumno Jesse Pinkman.', duration: '58m' },
      { seasonNumber: 1, episodeNumber: 2, title: 'El Gato en la Bolsa', description: 'Walter y Jesse intentan vender su producto pero se enfrentan a problemas logísticos y a un narcotraficante despiadado.', duration: '48m' },
      { seasonNumber: 1, episodeNumber: 3, title: 'Y la Bolsa Estaba en el Suelo', description: 'Walter y Jesse deben deshacerse de un cuerpo. Skyler comienza a sospechar del comportamiento de Walter.', duration: '49m' },
      { seasonNumber: 1, episodeNumber: 4, title: 'Cancer Man', description: 'Walter Jr. organiza una recaudación de fondos para el tratamiento de su padre sin saber toda la verdad.', duration: '48m' },
      { seasonNumber: 1, episodeNumber: 5, title: 'Gris Gris', description: 'Walter y Jesse buscan un nuevo distribuidor mientras su negocio crece. Hank se acerca más a la verdad.', duration: '49m' },
      { seasonNumber: 1, episodeNumber: 6, title: "Crazy Handful of Nothin'", description: 'Un problema con el producto obliga a Walter a tomar medidas drásticas. Jesse se complica con su vecina.', duration: '48m' },
      { seasonNumber: 1, episodeNumber: 7, title: 'Un Negro en Aceite', description: 'Walter y Jesse tienen diferencias sobre el negocio. Tuco demuestra su lado más violento.', duration: '48m' },
      { seasonNumber: 1, episodeNumber: 8, title: 'Cero Comentario', description: 'Hank descubre una conexión entre las muertes y el mundo de las drogas. Walter decide confesar la verdad a Skyler.', duration: '47m' },
    ],
  },
  {
    title: 'Game of Thrones',
    description: 'Noble familias de Westeros luchan por el control del Trono de Hierro mientras una antigua amenaza emerge del norte. Traición, ambición y magia colisionan en una batalla épica por el poder.',
    year: 2011, rating: 8.5, duration: null,
    genre: 'Acción, Aventura, Drama, Fantasía', type: 'series', maturity: 'TV-MA', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
    episodes: [
      { seasonNumber: 1, episodeNumber: 1, title: 'Winter Is Coming', description: 'Ned Stark, Lord de Winterfell, viaja al sur para servir como Mano del Rey del Rey Robert. Un secreto oscuro amenaza a la familia real.', duration: '62m' },
      { seasonNumber: 1, episodeNumber: 2, title: 'The Kingsroad', description: 'Mientras viajan hacia el sur, la familia Stark se enfrenta a peligros. Bran descubre un secreto que lo pondrá en grave peligro.', duration: '56m' },
      { seasonNumber: 1, episodeNumber: 3, title: 'Lord Snow', description: 'Jon Snow comienza su entrenamiento en el Muro. Daenerys se adapta a su nuevo rol como esposa del Khal Drogo.', duration: '58m' },
      { seasonNumber: 1, episodeNumber: 4, title: 'Cripples, Bastards, and Broken Things', description: 'Un torneo celebra la Mano del Rey. Tyrion se gana el desprecio de su hermana. Viserys se desespera por conseguir un ejército.', duration: '55m' },
      { seasonNumber: 1, episodeNumber: 5, title: 'The Wolf and the Lion', description: 'Tywin enseña a Jaime sobre el poder. Catelyn arresta a Tyrion por el intento de asesinato de Bran. Robert sufre una herida fatal durante una cacería.', duration: '56m' },
      { seasonNumber: 1, episodeNumber: 6, title: 'A Golden Crown', description: 'Viserys intenta robar los huevos de dragón de Daenerys. Drogo promete a Daenerys el Trono de Hierro. Ned descubre la verdad sobre los hijos de Robert.', duration: '53m' },
      { seasonNumber: 1, episodeNumber: 7, title: 'You Win or You Die', description: 'Ned confronta a Cersei sobre los secretos de la familia. Robb llama a los banners del norte. Daenerys consume la sopa de corazón.', duration: '58m' },
      { seasonNumber: 1, episodeNumber: 8, title: 'The Pointy End', description: 'Ned es arrestado por traición. Robb Stark es proclamado Rey en el Norte. Daenerys emerge de las llamas con tres dragones recién nacidos.', duration: '63m' },
    ],
  },
  {
    title: 'Naruto',
    description: 'Naruto Uzumaki, un ninja adolescente travieso, lucha por obtener reconocimiento y sueña con convertirse en el Hokage, el líder y ninja más fuerte de su aldea. En un mundo de ninjas y misiones peligrosas, Naruto descubrirá el verdadero significado de la amistad y el sacrificio.',
    year: 2002, rating: 8.4, duration: null,
    genre: 'Acción, Aventura, Animación, Fantasía', type: 'series', maturity: 'TV-PG', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/xppeysfvDKVx775MFuH8Z9BlpMk.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/xppeysfvDKVx775MFuH8Z9BlpMk.jpg',
    episodes: [
      { seasonNumber: 1, episodeNumber: 1, title: 'Entrada! Naruto Uzumaki!', description: 'Naruto se gradúa de la academia ninja y es asignado al Equipo 7 junto a Sasuke y Sakura bajo la tutela de Kakashi Hatake.', duration: '23m' },
      { seasonNumber: 1, episodeNumber: 2, title: 'Mi Nombre es Konohamaru!', description: 'Konohamaru, nieto del Tercer Hokage, se inspira en Naruto para ser reconocido por su propio mérito.', duration: '23m' },
      { seasonNumber: 1, episodeNumber: 3, title: 'Rivalidad! Sasuke y Sakura', description: 'Sasuke demuestra su increíble habilidad. Naruto y Sakura deben aprender a trabajar en equipo.', duration: '23m' },
      { seasonNumber: 1, episodeNumber: 4, title: 'Prueba de Supervivencia!', description: 'El Equipo 7 enfrenta su primera misión real: proteger a un anciano durante un viaje peligroso.', duration: '23m' },
      { seasonNumber: 1, episodeNumber: 5, title: 'Misión: País del Onda', description: 'El equipo llega a la Tierra del Onda y descubre que los puentes han sido destruidos por un atacante misterioso.', duration: '23m' },
      { seasonNumber: 1, episodeNumber: 6, title: 'Una Promesa solemne', description: 'Naruto hace una promesa importante mientras la misión se vuelve más peligrosa de lo esperado.', duration: '23m' },
    ],
  },
  {
    title: 'Stranger Things',
    description: 'Cuando un niño desaparece, un pequeño pueblo descubre un misterio que involucra experimentos secretos, fuerzas sobrenaturales aterradoras y una niña extraña. Un grupo de amigos se enfrenta a lo desconocido mientras el gobierno intenta ocultar la verdad.',
    year: 2016, rating: 8.6, duration: null,
    genre: 'Drama, Fantasía, Terror, Ciencia Ficción', type: 'series', maturity: 'TV-14', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg',
    episodes: [
      { seasonNumber: 1, episodeNumber: 1, title: 'El Desaparecido del Castillo Hawk', description: 'Will Byers desaparece misteriosamente después de una partida de Dungeons & Dragons. Su madre Joyce y el sheriff Hopper inician la búsqueda.', duration: '51m' },
      { seasonNumber: 1, episodeNumber: 2, title: 'La Maldición de la Vecina', description: 'Lucas, Mike y Dustin intentan encontrar a Will. Una niña misteriosa llamada Eleven aparece y parece saber la verdad.', duration: '55m' },
      { seasonNumber: 1, episodeNumber: 3, title: 'Holly, Jolly', description: 'Joyce se comunica con Will a través de luces navideñas. Eleven escapa del laboratorio de Hawkins y busca refugio con los chicos.', duration: '51m' },
      { seasonNumber: 1, episodeNumber: 4, title: 'El Cuerpo', description: 'El sheriff Hopper descubre el laboratorio secreto. Eleven demuestra sus poderes psíquicos. Los chicos buscan la puerta a donde está Will.', duration: '52m' },
      { seasonNumber: 1, episodeNumber: 5, title: 'La Pulga y el Fiestero', description: 'Nancy y Jonathan descubren que el monstruo del Mundo del Revés acecha a Will. Eleven ayuda a los chicos a comunicarse con él.', duration: '53m' },
      { seasonNumber: 1, episodeNumber: 6, title: 'El Monstruo', description: 'El grupo se prepara para confrontar al Demogorgon. Eleven enfrenta su pasado en el laboratorio mientras busca cerrar la puerta.', duration: '53m' },
      { seasonNumber: 1, episodeNumber: 7, title: 'La Bañera', description: 'Joyce construye un portal de comunicación. Los adultos finalmente creen en la historia de los chicos. El plan para rescatar a Will se pone en marcha.', duration: '50m' },
      { seasonNumber: 1, episodeNumber: 8, title: 'El Mundo del Revés', description: 'Joyce y Hopper entran al Mundo del Revés para rescatar a Will. Eleven usa sus poderes para cerrar la brecha y enfrentar al Demogorgon.', duration: '55m' },
    ],
  },
  {
    title: 'The Boys',
    description: 'Un grupo de vigilantes conocido informalmente como "The Boys" se propone derribar a superhéroes corruptos con nada más que arrojo de clase trabajadora y la disposición a luchar sucio. Cuando los héroes más poderosos del mundo se vuelven contra los que deberían proteger, alguien tiene que hacerles frente.',
    year: 2019, rating: 8.7, duration: null,
    genre: 'Acción, Ciencia Ficción, Comedia, Crimen', type: 'series', maturity: 'TV-MA', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/in1R2dDc421JxsoRWaIIAqVI2KE.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/in1R2dDc421JxsoRWaIIAqVI2KE.jpg',
    episodes: [
      { seasonNumber: 1, episodeNumber: 1, title: 'El Nombre del Juego', description: 'Hughie Campbell busca venganza contra el superhéroe A-Train después de que este mate a su novia. Billy Butcher lo recluta para "The Boys".', duration: '59m' },
      { seasonNumber: 1, episodeNumber: 2, title: 'Cherry', description: 'Los Seven organizan un evento de relaciones públicas. Hughie consigue trabajo en Vought. Starlight descubre la verdad sobre los héroes.', duration: '58m' },
      { seasonNumber: 1, episodeNumber: 3, title: 'Recibiendo las Cosas Mal', description: 'Butcher presiona a Hughie para que consiga información desde dentro de Vought. Starlight lucha contra la cultura de abuso en los Seven.', duration: '56m' },
      { seasonNumber: 1, episodeNumber: 4, title: 'La Hembra del Cerdo', description: 'Los chicos rastrean un nexo entre Vought y terroristas. Kimiko y Frenchie son introducidos. Butcher revela más sobre su pasado.', duration: '57m' },
      { seasonNumber: 1, episodeNumber: 5, title: 'Buenas Vibraciones', description: 'Una conspiración más grande comienza a revelarse. Homelander demuestra su lado más oscuro y peligroso.', duration: '55m' },
      { seasonNumber: 1, episodeNumber: 6, title: 'Nada Como Esto', description: 'La verdad sobre Compound V sale a la luz. Hughie y Annie se acercan. Butcher encuentra una pista crucial.', duration: '53m' },
    ],
  },
  {
    title: 'The Last of Us',
    description: 'Veinte años después de que una infección por hongos devastara la civilización, Joel, un sobreviviente endurecido, es contratado para sacar a Ellie, una niña de catorce años, de una zona de cuarentena militar. Lo que comienza como un pequeño trabajo se convierte en una brutal y dolorosa travesía por los Estados Unidos.',
    year: 2023, rating: 8.8, duration: null,
    genre: 'Acción, Aventura, Drama, Terror, Ciencia Ficción', type: 'series', maturity: 'TV-MA', featured: false,
    coverImage: 'https://image.tmdb.org/t/p/w500/dmo6TYuuJgaYinXBPjrgG9mB5od.jpg',
    backdropImage: 'https://image.tmdb.org/t/p/w500/dmo6TYuuJgaYinXBPjrgG9mB5od.jpg',
    episodes: [
      { seasonNumber: 1, episodeNumber: 1, title: 'Cuando Eres Perdido en la Oscuridad', description: 'En 2003, el brote de Cordyceps cambia el mundo para siempre. En 2023, Joel vive en una zona de cuarentena en Boston y acepta un trabajo para contrabandear a Ellie.', duration: '81m' },
      { seasonNumber: 1, episodeNumber: 2, title: 'Infectado', description: 'Joel y Ellie comienzan su viaje hacia el oeste. Descubren que el viaje será mucho más peligroso de lo esperado cuando se encuentran con infectados.', duration: '53m' },
      { seasonNumber: 1, episodeNumber: 3, title: 'Largo, Largo Tiempo', description: 'Joel y Ellie buscan a Bill, un viejo amigo que podría tener un vehículo. Los recuerdos del pasado de Joel salen a la superficie.', duration: '71m' },
      { seasonNumber: 1, episodeNumber: 4, title: 'Por Favor, Sujétame la Mano', description: 'Joel y Ellie llegan a Kansas City donde son capturados por Kathleen, la líder de los rebeldes. Henry y Sam se ven involucrados.', duration: '55m' },
      { seasonNumber: 1, episodeNumber: 5, title: 'Soportar y Sobrevivir', description: 'Joel y Ellie continúan su viaje a través de Wyoming. Enfrentan tanto infectados como supervivientes hostiles.', duration: '53m' },
      { seasonNumber: 1, episodeNumber: 6, title: 'Familia', description: 'Joel y Ellie llegan a Jackson, Wyoming, donde Tommy, el hermano de Joel, lidera una comunidad próspera. Joel debe tomar una decisión crucial.', duration: '71m' },
      { seasonNumber: 1, episodeNumber: 7, title: 'Left Behind', description: 'Ellie recuerda su pasado en la escuela militar de FEDRA y su relación con Riley. Un momento que cambió todo para ella.', duration: '57m' },
      { seasonNumber: 1, episodeNumber: 8, title: 'Cuando Eramos Jóvenes', description: 'Joel y Ellie por fin llegan a Salt Lake City. Lo que descubren allí cambiará todo. Joel debe tomar la decisión más difícil de su vida.', duration: '80m' },
    ],
  },
]

async function main() {
  console.log('Seeding database...')

  await db.watchProgress.deleteMany()
  await db.favorite.deleteMany()
  await db.episode.deleteMany()
  await db.movie.deleteMany()

  for (const m of movies) {
    await db.movie.create({
      data: {
        title: m.title,
        description: m.description,
        coverImage: m.coverImage,
        backdropImage: m.backdropImage,
        year: m.year,
        rating: m.rating,
        duration: m.duration,
        genre: m.genre,
        type: m.type,
        maturity: m.maturity,
        featured: m.featured,
      },
    })
  }
  console.log(`Seeded ${movies.length} peliculas`)

  let totalEpisodes = 0
  for (const s of seriesData) {
    await db.movie.create({
      data: {
        title: s.title,
        description: s.description,
        coverImage: s.coverImage,
        backdropImage: s.backdropImage,
        year: s.year,
        rating: s.rating,
        duration: s.duration,
        genre: s.genre,
        type: s.type,
        maturity: s.maturity,
        episodes: {
          create: s.episodes.map((ep) => ({
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
            title: ep.title,
            description: ep.description,
            duration: ep.duration,
          })),
        },
      },
    })
    totalEpisodes += s.episodes.length
    console.log(`  "${s.title}" - ${s.episodes.length} episodios`)
  }

  const totalMovies = await db.movie.count()
  const totalEps = await db.episode.count()
  console.log(`\nSeed complete!`)
  console.log(`  ${totalMovies} titulos (${movies.length} peliculas, ${seriesData.length} series)`)
  console.log(`  ${totalEps} episodios`)
  console.log(`\nRefresca el navegador.`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e)
    process.exit(1)
  })