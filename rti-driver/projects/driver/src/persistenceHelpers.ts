namespace PersistenceHelpers {
    export function ReadChunked(key: string): string | null {
        let chunkCount = parseInt(Persistence.Read(key));
        if (isNaN(chunkCount)) return null;
    
        let result = "";
        for (let i = 0; i < chunkCount; i++) {
            result += Persistence.Read(key + "_chunk" + i);
        }
        return result;
    }

    export function WriteChunked(key: string, value: string, chunkSize: number): boolean {
        if (!value) return false;

        let chunkCount = value.length/chunkSize + 1;
        let result = Persistence.Write(key, chunkCount.toString());
        for (let i = 0; i < chunkCount; i++) {
            result = result && Persistence.Write(key + "_chunk" + i, value.substr(i * chunkSize, chunkSize));
        }
        return result;
    }

    export function DeleteChunked(key: string): boolean {
        let chunkCount = parseInt(Persistence.Read(key));
        if (isNaN(chunkCount)) return false;

        let result = Persistence.Delete(key);
        for (let i = 0; i < chunkCount; i++) {
            result = result && Persistence.Delete(key + "_chunk" + i);
        }
        return result;
    }
}