// Which Claro supervisors each JAF supervisor works with, from the client's
// "Supervisores de Claro" sheet (Oct 2026). A Claro supervisor can sit under
// more than one JAF supervisor (same person, same email), so the link is many
// to many. Entries the sheet lists without an email are left out until Admin
// has one. Admin edits the links afterwards on Admin → Claro supervisors; the
// seed only ever adds links, never removes one.
export const CLARO_SUPERVISOR_LINKS: {
	jafEmail: string
	claro: { name: string; email: string }[]
}[] = [
	{
		jafEmail: "eocasio@jafcom.net", // Edgar Ocasio
		claro: [
			{ name: "Alexander Sosa", email: "alexander.sosa@claropr.com" },
			{ name: "Andrew Garcia", email: "anfrew.garcia1@claropr.com" },
			{ name: "Armando Core", email: "armando.core@claropr.com" },
			{ name: "Hector D Hoyos", email: "hector.dehoyos@claropr.com" },
			{ name: "Jose Pagan", email: "jose.pagan1@claropr.com" },
			{ name: "Pedro Martinez", email: "pedro.martinez2@claropr.com" },
			{ name: "Oscar Sotomayor", email: "oscar.sotomayor@claropr.com" },
			{ name: "Leslie Serrano", email: "leslie.serrano@claropr.com" },
			{ name: "Leslie Figueroa", email: "lesly.figueroa2@claropr.com" },
			{ name: "Jose Atanacio", email: "jose.atanacio@claropr.com" },
			{ name: "Kevin Galarza", email: "kevin.galarza@claropr.com" },
			{ name: "Sigredo Cuevas", email: "sigfredo.cuevas@claropr.com" },
			{ name: "Juan Alicea", email: "juan.alicea@claropr.com" },
		],
	},
	{
		jafEmail: "charlie@jafcom.net", // Charlie Gonzalez
		claro: [
			{ name: "Genaro Gabriel", email: "ggabriel@claropr.com" },
			{ name: "Moises Villegas", email: "moises.villegas@claropr.com" },
			{ name: "Ramon Berrios", email: "ramon.berrios@claropr.com" },
			{ name: "Andrew Garcia", email: "anfrew.garcia1@claropr.com" },
			{ name: "Miguel Cabrera", email: "miguel.cabrera6@claropr.com" },
			{ name: "Jose Alvarez", email: "jose.alvarez@claropr.com" },
			{ name: "Jose Atanacio", email: "jose.atanacio@claropr.com" },
			{ name: "Alexander Sosa", email: "alexander.sosa@claropr.com" },
			{ name: "Juan Alicea", email: "juan.alicea@claropr.com" },
			{ name: "Kevin Galarza", email: "kevin.galarza@claropr.com" },
		],
	},
	{
		jafEmail: "irivera@jafcom.net", // Luis A Rivera
		claro: [
			{ name: "Wilson Maldonado", email: "wilson.maldonado@claropr.com" },
			{ name: "Jossean Lopez", email: "jossean.lopez@claropr.com" },
			{ name: "David Rios", email: "david.rios@claropr.com" },
			{ name: "Arnaldo Tejedor", email: "arnaldo.tejedor@claropr.com" },
			{ name: "Luis Pantojas", email: "luis.pantojas@claropr.com" },
			{ name: "Hector Morales", email: "hector.morales@claropr.com" },
			{ name: "Carlos Vega", email: "carlos.vega3@claropr.com" },
			{ name: "Victor Cosme", email: "victor.cosme2@claropr.com" },
			{ name: "Wesley Serrano", email: "wesley.serrano@claropr.com" },
		],
	},
	{
		jafEmail: "rramos@jafcom.net", // Ramon Ramos; Carlos Rodriguez and Miguel Mattei have no email yet
		claro: [
			{ name: "Ricardo Santiago", email: "ricardo.santiago@claropr.com" },
			{ name: "Daniel Martell", email: "daniel.martell@claropr.com" },
			{ name: "Yamil Olivo", email: "yamil.olivo@claropr.com" },
			{ name: "Jose Irizarry", email: "jose.irizarry@claropr.com" },
		],
	},
]
