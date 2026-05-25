export type BitrixFieldMapKey =
  | "brand"
  | "model"
  | "pseudoModel"
  | "generation"
  | "year"
  | "mileage"
  | "body"
  | "color"
  | "drive"
  | "engine"
  | "gear"
  | "power"
  | "volume"
  | "wheel"
  | "doors"
  | "vin"
  | "dmsCarId"
  | "equipmentName"
  | "modificationName"
  | "stockState"
  | "saleStatus"
  | "publishStatus"
  | "vehicleAvailability"
  | "vehicleState"
  | "dealerSitePublicationUrl"
  | "publicationDescription"
  | "photos"
  | "photosUrls";

export const bitrixFieldMap: Record<BitrixFieldMapKey, string> = {
  brand: "property108",
  model: "property110",
  pseudoModel: "",
  generation: "property112",
  year: "property114",
  mileage: "property116",
  body: "property120",
  color: "property122",
  drive: "property132",
  engine: "property124",
  gear: "property130",
  power: "property128",
  volume: "property126",
  wheel: "property134",
  doors: "property136",
  vin: "property118",
  dmsCarId: "",
  equipmentName: "property138",
  modificationName: "property140",
  stockState: "property142",
  saleStatus: "property144",
  publishStatus: "property146",
  vehicleAvailability: "property148",
  vehicleState: "property150",
  dealerSitePublicationUrl: "property152",
  publicationDescription: "",
  photos: "",
  photosUrls: "property154"
};

export function getConfiguredBitrixFieldMapEntries(): Array<[BitrixFieldMapKey, string]> {
  return (Object.entries(bitrixFieldMap) as Array<[BitrixFieldMapKey, string]>).filter(
    ([, bitrixProperty]) => bitrixProperty.trim() !== ""
  );
}

export function hasConfiguredBitrixFieldMap(): boolean {
  return getConfiguredBitrixFieldMapEntries().length > 0;
}
