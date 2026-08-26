// Roblox API metadata. The Data literal below is generated upstream and kept verbatim.

type RawEnum = [string, string[]]
type RawMember = number | [number, number?]
type RawClass = [string, unknown, unknown, unknown]

export interface PropInfo {
	Group: string
	EnumType?: string
	EnumItems?: string[]
}

export interface ClassInfo {
	Name: string
	Superclass: ClassInfo | null
	Members?: Record<string, PropInfo>
	ExplorerOrder?: number
	ExplorerIcon?: number
}

import Data from "@/rbx/ApiDump.data.json"

export const ApiDump = (() => {

	const categories = Data.Categories as string[]
	const rawEnums = Data.Enums as unknown as RawEnum[]
	const rawClasses = Data.Classes as unknown as RawClass[]

	const ZeroClassName = rawClasses[0][0]

	const enumsByName: Record<string, string[]> = {}
	const classesByName: Record<string, ClassInfo> = {}

	let isPrepared = false

	const groupOf = (index: number): string => index === -1 ? "HIDDEN" : categories[index]

	const prepare = (): void => {
		if(isPrepared) { return }
		isPrepared = true

		for(const [name, items] of rawEnums) {
			enumsByName[name] = items
		}

		for(const entry of rawClasses) {
			let [className, superClass, members, rmd] = entry as [string, any, any, any]

			if(typeof superClass !== "number") {
				rmd = members
				members = superClass
				superClass = null
			}

			const parentName = rawClasses[superClass || 0][0]
			const parent = className === parentName ? null : classesByName[parentName] ?? null

			let resolved: Record<string, PropInfo> | undefined

			if(members) {
				resolved = {}

				for(const [prop, value] of Object.entries(members as Record<string, RawMember>)) {
					if(typeof value === "number") {
						resolved[prop] = { Group: groupOf(value) }
					} else {
						const [cat, enumIndex] = value
						const [enumType, enumItems] = rawEnums[enumIndex || 0]

						resolved[prop] = {
							Group: groupOf(cat ?? 0),
							EnumType: enumType,
							EnumItems: enumItems
						}
					}
				}
			}

			classesByName[className] = {
				Name: className,
				Superclass: parent,
				Members: resolved,
				ExplorerOrder: typeof rmd === "number" ? rmd : Array.isArray(rmd) ? rmd[0] : undefined,
				ExplorerIcon: Array.isArray(rmd) ? rmd[1] : undefined
			}
		}
	}

	const getPropInfo = (className: string, prop: string): PropInfo | null => {
		prepare()

		let target: ClassInfo | null = classesByName[className] ?? classesByName[ZeroClassName] ?? null

		while(target) {
			const propInfo = target.Members?.[prop]
			if(propInfo) { return propInfo }

			target = target.Superclass
		}

		return null
	}

	return {
		getEnums(): Record<string, string[]> {
			prepare()
			return enumsByName
		},

		getEnum(name: string): string[] | undefined {
			prepare()
			return enumsByName[name]
		},

		getEnumName(enumType: string, value: number): string | undefined {
			prepare()
			return enumsByName[enumType]?.[value]
		},

		getPropertyGroup(className: string, prop: string): string {
			return getPropInfo(className, prop)?.Group ?? "Unknown"
		},

		getPropertyEnumName(className: string, prop: string, value: number): string | null {
			return getPropInfo(className, prop)?.EnumItems?.[value] ?? null
		},

		getExplorerIconIndex(className: string): number {
			prepare()
			return classesByName[className]?.ExplorerIcon ?? 0
		},

		getExplorerOrder(className: string): number {
			prepare()
			return classesByName[className]?.ExplorerOrder ?? 2 ** 53
		}
	}
})()
