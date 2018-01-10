exports.makeDummyTracer = function(){
  return {
    tracingDisabled: true,
    scoped: cb => cb(),
    createChildId: () => null,
    createRootId: () => null,
    setId: () => {},
    recordServiceName: () => {},
    recordRpc: () => {},
    recordBinary: () => {},
    recordAnnotation: () => {},
    local: (name, cb) => cb(),
    _localEndpoint: {},
  };
};


exports.makeLocalCallsWrapper = function(req, tracer){
  return (name, callable) => {
    return tracer.scoped(() => {
      tracer.setId(req.zipkinTraceId);
      return tracer.local(name, callable);
    });
  }
};

exports.safeStringify = function(object){
  try {
    return JSON.stringify(object)
  } catch(e){
    return `Error tracking object: ${e.message}`;
  }
};