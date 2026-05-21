const { NumberField, StringField } = foundry.data.fields;

export class HexDataModel extends foundry.abstract.DataModel {
    static defineSchema() {
        return {
            // The coordinate acts as the unique identifier (e.g., "0,1")
            coordinate: new StringField({ required: true, blank: false }),

            // The raw noise data [0 - 1]
            elevation: new NumberField({ required: true, initial: 0, min: 0, max: 1 }),
        };
    }
}
