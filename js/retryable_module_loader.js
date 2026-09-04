export function createRetryableModuleLoader(importModule) {
    let module = null;
    let pending = null;
    let attempts = 0;

    return {
        get loadedModule() {
            return module;
        },
        load() {
            if (module) return Promise.resolve(module);
            if (!pending) {
                attempts += 1;
                pending = Promise.resolve()
                    .then(() => importModule(attempts))
                    .then(loaded => {
                        module = loaded;
                        return loaded;
                    })
                    .catch(error => {
                        pending = null;
                        throw error;
                    });
            }
            return pending;
        },
    };
}